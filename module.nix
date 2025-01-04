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
      enable = lib.mkEnableOption "Enable the rudelshopping service.";

      host = lib.mkOption {
        type = lib.types.str;
        default = "localhost";
        example = "192.168.22.22";
        description = lib.mdDoc "Address to serve on.";
      };

      port = lib.mkOption {
        type = lib.types.int;
        default = 3000;
        example = 3000;
        description = lib.mdDoc "Port to serve on.";
      };

      origin = lib.mkOption {
        type = lib.types.str;
        default = "http://localhost:3000";
        example = "https://example.com";
        description = lib.mdDoc "Origin for CORS and stuff.";
      };

      package = lib.mkOption {
        type = lib.types.package;
        description = lib.mdDoc "rudelshopping package used for the service.";
        default = pkgs.rudelshopping;
        defaultText = lib.literalExpression "packages.rudelshopping";
      };
    };
  };

  config = lib.mkIf cfg.enable (
    let
      dataDirectory = "/var/lib/rudelshopping";
      databaseFile = "${dataDirectory}/db.sqlite";
    in
    {
      users.users.rudelshopping = {
        isSystemUser = true;
        createHome = true;
        home = dataDirectory;
        group = "rudelshopping";
      };
      users.groups.rudelshopping = { };

      systemd.services."rudelshopping" = {
        serviceConfig = {
          Type = "simple";
          User = "rudelshopping";
          Group = "rudelshopping";
          Restart = "on-failure";
          RestartSec = "30s";
          ExecStart = "${lib.getExe pkgs.rudelshopping}";
        };
        wantedBy = [ "multi-user.target" ];

        description = "rudelshopping server";

        environment = {
          DATABASE_URL = "file:${databaseFile}";
          HOST = "${cfg.host}";
          PORT = "${builtins.toString cfg.port}";
          ORIGIN = "${cfg.origin}";
          NODE_ENV = "production";
        };

        documentation = [
          "https://github.com/zebreus/rudelshopping"
        ];
      };
    }
  );
}
