{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.rudelshopping;
in
{
  options = {
    services.rudelshopping = {
      enable = lib.mkEnableOption "the rudelshopping service";

      host = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
        example = "192.168.22.22";
        description = "Address to serve on.";
      };

      port = lib.mkOption {
        type = lib.types.int;
        default = 3000;
        description = "Port to serve on.";
      };

      origin = lib.mkOption {
        type = lib.types.str;
        default = "http://localhost:3000";
        example = "https://example.com";
        description = "Origin for CORS and stuff.";
      };

      stripeKeyFile = lib.mkOption {
        type = lib.types.path;
        example = "/run/agenix/rudelshopping-stripe";
      };

      package = lib.mkOption {
        type = lib.types.package;
        description = "rudelshopping package used for the service.";
        default = pkgs.rudelshopping;
        defaultText = lib.literalExpression "packages.rudelshopping";
      };
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.rudelshopping = {
      isSystemUser = true;
      group = "rudelshopping";
    };
    users.groups.rudelshopping = { };

    systemd.services."rudelshopping" = {
      serviceConfig = {
        User = "rudelshopping";
        Group = "rudelshopping";
        Restart = "on-failure";
        RestartSec = "30s";
        ExecStart = "${lib.getExe cfg.package}";

        # The Stripe secret is loaded as a systemd credential from a file
        # outside the store (e.g. agenix). systemd mounts it read-only at
        # $CREDENTIALS_DIRECTORY/stripe; main.ts reads it from there.
        LoadCredential = "stripe:${cfg.stripeKeyFile}";

        # Light systemd hardening. The server only reads its own files from the
        # read-only nix store and makes outbound HTTPS calls to Stripe; it needs
        # no writable state, no home, and no devices.
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectProc = "invisible";
        ProtectControlGroups = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectClock = true;
        ProtectHostname = true;
        NoNewPrivileges = true;
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        LockPersonality = true;
        RemoveIPC = true;

        # AF_UNIX is kept so glibc can reach nscd for DNS when resolving the
        # Stripe API host; AF_INET/AF_INET6 carry the actual HTTPS traffic.
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];

        # Only grant the privileged-port bind capability when actually needed.
        CapabilityBoundingSet = lib.optionals (cfg.port < 1024) [ "CAP_NET_BIND_SERVICE" ];
        AmbientCapabilities = lib.optionals (cfg.port < 1024) [ "CAP_NET_BIND_SERVICE" ];

        # Syscall allow-list, kept broad enough for the V8/libuv runtime.
        SystemCallArchitectures = "native";
        SystemCallFilter = [
          "@system-service"
          "~@privileged"
        ];
      };
      wantedBy = [ "multi-user.target" ];

      description = "rudelshopping server";

      environment = {
        HOST = "${cfg.host}";
        PORT = "${builtins.toString cfg.port}";
        ORIGIN = "${cfg.origin}";
        NODE_ENV = "production";
      };

      documentation = [
        "https://github.com/zebreus/rudelshopping"
      ];
    };
  };
}
