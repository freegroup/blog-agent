import { loadSettings, section } from "@blogagent/config";

/**
 * sink-file's configuration in one place. index.js reads from here — never from
 * process.env or loadSettings directly. `buildConfig` is pure (settings in, config
 * out) so it is unit-testable with a fake settings object; `config` is the live
 * instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "sink-file");
  return {
    port: cfg.num("port", 5082),
    targetDir: cfg.str("target_dir", "./var/sink"),
    imageWidth: cfg.num("image_width", 1600),
    maxImageBytes: cfg.num("max_image_bytes", 2 * 1024 * 1024),
  };
}

export const config = buildConfig(loadSettings());
