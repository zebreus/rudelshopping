{
  buildNpmPackage,
  makeWrapper,
  nodejs_24,
  lib,
  ...
}:
buildNpmPackage {
  pname = "rudelshopping";
  version = "0.0.1";

  src = ./.;

  nodejs = nodejs_24;

  nativeBuildInputs = [ makeWrapper ];

  npmDepsHash = "sha256-R2TYoO/GpkDDlTgTjMSgPihs/xYMyHTi4fzIS9iwyqg=";

  dontNpmBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out/lib/rudelshopping $out/bin
    cp -r . $out/lib/rudelshopping

    makeWrapper ${lib.getExe nodejs_24} $out/bin/rudelshopping \
      --add-flags "$out/lib/rudelshopping/main.ts"

    runHook postInstall
  '';

  meta = {
    mainProgram = "rudelshopping";
  };
}
