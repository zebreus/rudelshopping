{
  description = "Reimplementing strichliste in svelte";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:nixos/nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      rec {
        packages.rudelshopping = pkgs.callPackage ./default.nix { };
        packages.default = packages.rudelshopping;

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_24
          ];
        };

        checks.opensPort = pkgs.testers.nixosTest {
          name = "rudelshopping-opens-port";
          nodes.machine =
            { config, pkgs, ... }:
            {
              imports = [ nixosModules.rudelshopping ];
              services.rudelshopping = {
                enable = true;
                # A dummy key: the server only talks to Stripe on /submit-order,
                # so binding the port succeeds without a real one. Loaded as a
                # systemd credential (raw value, no KEY= prefix).
                stripeKeyFile = pkgs.writeText "rudelshopping-stripe" ''
                  sk_test_dummy
                '';
              };
            };
          testScript = ''
            machine.wait_for_unit("rudelshopping.service")
            machine.wait_for_open_port(3000)
          '';
        };

        nixosModules.rudelshopping = {
          nixpkgs.overlays = [
            (final: prev: {
              inherit (packages) rudelshopping;
            })
          ];
          imports = [ ./module.nix ];
        };
        nixosModules.default = nixosModules.rudelshopping;

        formatter = pkgs.nixfmt-rfc-style;
      }
    );
}
