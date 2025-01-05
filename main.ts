import { serveDir } from "jsr:@std/http/file-server";
import Stripe from "npm:stripe@^13.0.0";
import { z } from "npm:zod@^3.24.1";

const PORT = parseInt(Deno.env.get("PORT") || "3000");
const ORIGIN = Deno.env.get("ORIGIN") || "http://[::1]:3000";
const HOST = Deno.env.get("HOST") || "[::1]";

if (!Deno.env.get("STRIPE_SECRET_KEY")) {
  throw new Error("Missing STRIPE_SECRET_KEY environment variable");
}

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-08-16",
});

const deliveryMethodSchema = z.enum(["shipping", "w17", "gpn", "easterhegg"]);
const paymentMethodSchema = z.enum(["cash", "stripe"]);
const emailSchema = z.string().email();
const orderSchema = z.object({
  pcbOnlyQuantity: z.number().int().default(0),
  fullKitQuantity: z.number().int().default(0),
  pcbOnlyPrice: z.number().positive().default(7),
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
  deliveryMethod: DeliveryMethod
): Stripe.Checkout.SessionCreateParams.ShippingOption => {
  const rates: Record<
    string,
    Stripe.Checkout.SessionCreateParams.ShippingOption
  > = {
    shipping: {
      shipping_rate_data: {
        display_name: "Shipping by mail",
        fixed_amount: {
          amount: 420,
          currency: "eur",
        },
        metadata: {},
        tax_behavior: "exclusive",
        tax_code: "txcd_00000000",
        type: "fixed_amount",
      },
    },
    w17: {
      shipping_rate_data: {
        display_name: "Pickup at CCC Darmstadt",
        fixed_amount: {
          amount: 0,
          currency: "eur",
        },
        metadata: {},
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
        metadata: {},
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
        metadata: {},
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

const parseOrder = async (request: Request): Promise<Order> => {
  const formData = await request.formData();

  const pcbOnlyQuantity = parseInt(
    formData.get("pcbOnlyQuantity")?.toString() || "0",
    10
  );
  const fullKitQuantity = parseInt(
    formData.get("fullKitQuantity")?.toString() || "0",
    10
  );
  const pcbOnlyPrice = parseFloat(
    formData.get("pcbOnlyPrice")?.toString() || "7"
  );
  const fullKitPrice = parseFloat(
    formData.get("fullKitPrice")?.toString() || "9"
  );
  const email = formData.get("email");

  const unparsedOrder = {
    pcbOnlyQuantity,
    fullKitQuantity,
    pcbOnlyPrice,
    fullKitPrice,
    deliveryMethod: formData.get("deliveryMethod"),
    paymentMethod: formData.get("paymentMethod"),
    email: email,
    name: formData.get("name"),
    notes: formData.get("notes") || "",
  };

  const order = orderSchema.parse(unparsedOrder);

  if (order.pcbOnlyQuantity === 0 && order.fullKitQuantity === 0) {
    throw new Error(
      "You need to order at least one item. I mean it wouldn't be a preorder otherwise, right?"
    );
  }

  if (order.paymentMethod === "cash" && order.deliveryMethod === "shipping") {
    throw new Error(
      "You can only pay in cash for pickup orders. Maybe write me an email, we can figure something out."
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
          name: "Rudelblinken Kit",
        },
        unit_amount: Math.round(order.fullKitPrice * 100), // Stripe expects amounts in cents
      },
      quantity: order.fullKitQuantity,
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
          message: "Preorder for the next batch",
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

const processOrderSubmission = async (request: Request): Promise<Response> => {
  try {
    const order = await parseOrder(request);
    const sessionLink = await createCheckoutSession(order);
    return new Response(sessionLink, {
      status: 303,
      headers: { location: sessionLink },
    });
  } catch (err) {
    const parsedError = z
      .object({
        message: z.string(),
      })
      .safeParse(err);
    if (!parsedError.success) {
      return new Response("Something went wrong", { status: 400 });
    }
    return new Response(parsedError.data.message, { status: 400 });
  }
};

Deno.serve(
  {
    port: PORT,
    hostname: HOST,
  },
  async (request) => {
    const pathname = new URL(request.url).pathname;

    if (pathname == "/api/hello") {
      return new Response(JSON.stringify({ hello: "world" }), {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
        status: 200,
      });
    }

    if (pathname == "/submit-order") {
      return await processOrderSubmission(request);
    }

    return await serveDir(request, {
      fsRoot: "./",
      urlRoot: "",
      showIndex: true,
    });
  }
);
