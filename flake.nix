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
        name = "rudelshopping";

        packages.rudelshopping = pkgs.callPackage ./default.nix { };
        packages.default = packages.rudelshopping;

        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.deno
          ];
        };

        checks.opensPort = pkgs.nixosTest {
          name = "rudelshopping-opens-port";
          nodes.machine =
            { config, pkgs, ... }:
            {
              imports = [
                nixosModules.rudelshopping
                { services.rudelshopping.enable = true; }
              ];
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
