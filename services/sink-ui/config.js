import { loadSettings, section } from "@blogagent/config";

export function buildConfig(settings) {
  const cfg = section(settings, "sink-ui");
  return {
    port: cfg.num("port", 5091),
  };
}

export const config = buildConfig(loadSettings());
