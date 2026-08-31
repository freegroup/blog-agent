#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { crossSection, wireCrossSection, DELTA, GAMMA, SICHERHEIT, DURCHMESSER } from "./wire.js";

/**
 * Domain tool for camper-elektrik-planer.de.
 *
 * The only place in the system where a technical number may originate:
 * the newsroom never computes values itself, it calls here.
 * A wrong cross-section is a fire hazard.
 */
const server = new McpServer({ name: "mcp-calc", version: "0.1.0" });

server.registerTool(
  "wire_cross_section",
  {
    title: "Calculate cable cross-section",
    description:
      "Calculates the required conductor cross-section for a 12/24 V on-board cable. " +
      "Accounts for forward and return conductors, 2 % permitted voltage drop, and a 12 % " +
      "safety margin, then rounds up to the next commercially available cross-section. " +
      "Length is the ONE-WAY distance in centimetres.",
    inputSchema: {
      length_cm: z.number().positive().describe("One-way cable length in cm"),
      current_a: z.number().positive().describe("Continuous current in amperes"),
      voltage_v: z.number().positive().describe("System voltage, typically 12 or 24"),
    },
  },
  async ({ length_cm, current_a, voltage_v }) => {
    const raw = crossSection(length_cm, current_a, voltage_v);
    const chosen = wireCrossSection(length_cm, current_a, voltage_v);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              recommendation_mm2: chosen,
              computed_mm2: Number(raw.toFixed(2)),
              input: { length_cm, current_a, voltage_v },
              basis: {
                voltage_drop: `${DELTA * 100} %`,
                copper_conductivity: GAMMA,
                safety_margin: `${Math.round((SICHERHEIT - 1) * 100)} %`,
                standard_values_mm2: DURCHMESSER,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
