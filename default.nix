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
    cd $src
    ${lib.getExe deno} run --allow-net --allow-read="$src" main.ts
    EOF

    chmod a+rwx $out/bin/rudelshopping
  '';

  meta = {
    mainProgram = "rudelshopping";
  };
}
