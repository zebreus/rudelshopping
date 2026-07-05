import express from "express";
import Stripe from "stripe";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "3000");
const ORIGIN = process.env.ORIGIN || "http://[::1]:3000";
// Deno accepted the bracketed form "[::1]"; node's listen() wants it bare
const HOST = (process.env.HOST || "::1").replace(/^\[|\]$/g, "");

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-08-16",
});

const deliveryMethodSchema = z.enum(["shipping", "w17", "gpn", "easterhegg"]);
const paymentMethodSchema = z.enum(["cash", "stripe"]);
const emailSchema = z.string().email();
const orderSchema = z.object({
  pcbOnlyQuantity: z.number().int().default(0),
  partialKitQuantity: z.number().int().default(0),
  fullKitQuantity: z.number().int().default(0),
  pcbOnlyPrice: z.number().positive().default(7),
  partialKitPrice: z.number().positive().default(6),
  fullKitPrice: z.number().positive().default(9),
  deliveryMethod: deliveryMethodSchema.default("shipping"),
  paymentMethod: paymentMethodSchema.default("stripe"),
  email: emailSchema.default(""),
  name: z.string().default(""),
  notes: z.string().default(""),
});

/** All the information collected in the order form */
type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;
type PaymentMethod = z.infer<typeof paymentMethodSchema>;
type Order = z.infer<typeof orderSchema>;

const getShippingRate = (
  deliveryMethod: DeliveryMethod,
): Stripe.Checkout.SessionCreateParams.ShippingOption => {
  // const oneDay = 24 * 60 * 60 * 1000;
  // const daysUntilBatchA = Math.round(
  //   Math.max(0, (new Date(2025, 3, 1).getTime() - Date.now()) / oneDay)
  // );
  // const daysUntilBatchB = Math.round(
  //   Math.max(0, (new Date(2025, 12, 1).getTime() - Date.now()) / oneDay)
  // );
  // const daysUntilShipping =
  //   daysUntilBatchA >= 5
  //     ? daysUntilBatchA
  //     : daysUntilBatchB >= 5
  //     ? daysUntilBatchB
  //     : 365;

  const rates: Record<
    string,
    Stripe.Checkout.SessionCreateParams.ShippingOption
  > = {
    shipping: {
      shipping_rate_data: {
        display_name: "Shipping (Sometime)",
        fixed_amount: {
          amount: 420,
          currency: "eur",
        },
        tax_behavior: "exclusive",
        tax_code: "txcd_00000000",
        type: "fixed_amount",
        // delivery_estimate: {
        //   minimum: {
        //     unit: "day",
        //     value: daysUntilShipping,
        //   },
        //   maximum: {
        //     unit: "day",
        //     value: daysUntilShipping + 10,
        //   },
        // },
      },
    },
    w17: {
      shipping_rate_data: {
        display_name: "Pickup at CCC Darmstadt",
        fixed_amount: {
          amount: 0,
          currency: "eur",
        },
        tax_behavior: "exclusive",
        tax_code: "txcd_00000000",
        type: "fixed_amount",
      },
    },
    gpn: {
      shipping_rate_data: {
        display_name: "Pickup at GPN",
        fixed_amount: {
          amount: 0,
          currency: "eur",
        },
        tax_behavior: "exclusive",
        tax_code: "txcd_00000000",
        type: "fixed_amount",
      },
    },
    easterhegg: {
      shipping_rate_data: {
        display_name: "Pickup at Easterhegg",
        fixed_amount: {
          amount: 0,
          currency: "eur",
        },
        tax_behavior: "exclusive",
        tax_code: "txcd_00000000",
        type: "fixed_amount",
      },
    },
  };
  return rates[deliveryMethod];
};

const getCashCouponId = async () => {
  try {
    const existingCoupon = await stripe.coupons.retrieve("cash_on_pickup", {});
    if (existingCoupon.id !== "cash_on_pickup") {
      throw new Error("Coupon not found");
    }
    if (existingCoupon.percent_off !== 100) {
      throw new Error("Coupon has the wrong discount");
    }
    return existingCoupon.id;
  } catch (err) {
    console.error("Error retrieving cash coupon:", err);
  }
  const newCoupon = await stripe.coupons.create({
    id: "cash_on_pickup",
    percent_off: 100,
    duration: "forever",
    name: "Cash Payment on Pickup",
  });
  return newCoupon.id;
};

const parseOrder = (body: Record<string, unknown>): Order => {
  // With repeated fields express gives an array; take the first like FormData.get
  const field = (key: string): string | undefined => {
    const value = body[key];
    return (Array.isArray(value) ? value[0] : value)?.toString();
  };

  const pcbOnlyQuantity = parseInt(field("pcbOnlyQuantity") || "0", 10);
  const partialKitQuantity = parseInt(field("partialKitQuantity") || "0", 10);
  const fullKitQuantity = parseInt(field("fullKitQuantity") || "0", 10);
  const pcbOnlyPrice = parseFloat(field("pcbOnlyPrice") || "7");
  const partialKitPrice = parseFloat(field("partialKitPrice") || "6");
  const fullKitPrice = parseFloat(field("fullKitPrice") || "9");
  const email = field("email");

  const unparsedOrder = {
    pcbOnlyQuantity,
    partialKitQuantity,
    fullKitQuantity,
    pcbOnlyPrice,
    partialKitPrice,
    fullKitPrice,
    deliveryMethod: field("deliveryMethod"),
    paymentMethod: field("paymentMethod"),
    email: email,
    name: field("name"),
    notes: field("notes") || "",
  };

  const order = orderSchema.parse(unparsedOrder);

  if (order.fullKitQuantity > 0) {
    throw new Error(
      "Full kits are currently not available. Get the partial kit and print your own cat-ears instead.",
    );
  }

  if (order.pcbOnlyQuantity === 0 && order.partialKitQuantity === 0) {
    throw new Error(
      "You need to order at least one item. I mean it wouldn't be a preorder otherwise, right?",
    );
  }

  if (order.paymentMethod === "cash" && order.deliveryMethod === "shipping") {
    throw new Error(
      "You can only pay in cash for pickup orders. Maybe write me an email, we can figure something out.",
    );
  }

  return order;
};

const createCheckoutSession = async (order: Order): Promise<string> => {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price_data: {
        currency: "eur",
        product_data: {
          name: "Rudelblinken PCB",
        },
        unit_amount: Math.round(order.pcbOnlyPrice * 100), // Stripe expects amounts in cents
      },
      quantity: order.pcbOnlyQuantity,
    },
    {
      price_data: {
        currency: "eur",
        product_data: {
          name: "Rudelblinken Partial Kit",
        },
        unit_amount: Math.round(order.partialKitPrice * 100), // Stripe expects amounts in cents
      },
      quantity: order.partialKitQuantity,
    },
  ].filter((item) => item.quantity > 0);

  if (lineItems.length === 0) {
    throw new Error("No items in the order");
  }

  try {
    const session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      shipping_options: [getShippingRate(order.deliveryMethod)],
      shipping_address_collection:
        order.deliveryMethod === "shipping"
          ? {
              allowed_countries: ["DE"],
            }
          : undefined,
      mode: "payment",
      currency: "eur",
      customer_email: order.email,
      metadata: {
        name: order.name,
        notes: order.notes,
        shipping: order.deliveryMethod,
        payment: order.paymentMethod,
      },
      payment_intent_data: {
        metadata: {
          name: order.name,
          notes: order.notes,
          shipping: order.deliveryMethod,
          payment: order.paymentMethod,
        },
      },
      billing_address_collection: "auto",
      custom_text: {
        submit: {
          message: `The invoice does not include VAT in accordance with §19 UStG.`,
        },
      },
      discounts:
        order.paymentMethod == "cash"
          ? [
              {
                coupon: await getCashCouponId(),
              },
            ]
          : [],
      success_url: `${ORIGIN}/success.html`,
      cancel_url: `${ORIGIN}/failure.html`,
    });

    if (!session.url) {
      throw new Error("Did not receive a session URL from Stripe");
    }

    return session.url;
  } catch (err) {
    console.error("Error creating checkout session:", err);
    throw new Error("Failed to create checkout session");
  }
};

const app = express();

app.post(
  "/submit-order",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    try {
      const order = parseOrder(req.body);
      const sessionLink = await createCheckoutSession(order);
      res.redirect(303, sessionLink);
    } catch (err) {
      const parsedError = z
        .object({
          message: z.string(),
        })
        .safeParse(err);
      if (!parsedError.success) {
        res.status(400).send("Something went wrong");
        return;
      }
      res.status(400).send(parsedError.data.message);
    }
  },
);

app.use("/node_modules", (_req, res) => {
  res.status(404).end();
});
app.use(express.static(import.meta.dirname));

app.listen(PORT, HOST, () => {
  const displayHost = HOST.includes(":") ? `[${HOST}]` : HOST;
  console.log(`Listening on http://${displayHost}:${PORT}/`);
});
