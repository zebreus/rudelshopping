{
  stdenv,
  deno,
  lib,
  ...
}:
stdenv.mkDerivation {
  pname = "rudelshopping";
  version = "0.0.1";

  src = ./.;

  nativeBuildInputs = [
    deno
  ];

  installPhase = ''
    mkdir -p $out/bin

    cat <<EOF > $out/bin/rudelshopping
    #!/usr/bin/env bash
    ${lib.getExe deno} run --allow-net --allow-read --allow-write $src/main.ts
    EOF

    chmod a+rwx $out/bin/rudelshopping
  '';

  meta = {
    mainProgram = "rudelshopping";
  };
}
