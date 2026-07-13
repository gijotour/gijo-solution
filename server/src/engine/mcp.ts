import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// GIJO AS의 도구 레지스트리와 필요한 서비스들을 연결합니다.
// 예시로 간단한 보안 스캔 툴과 SBOM 요약 조회 기능을 제공합니다.

const server = new Server(
  {
    name: "gijo-as-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// MCP 툴 목록 정의
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "scan_asset",
        description: "지정된 자산 파일 또는 디렉토리에 대해 정적 보안 스캔을 수행하고 취약점 목록을 반환합니다.",
        inputSchema: {
          type: "object",
          properties: {
            assetPath: {
              type: "string",
              description: "보안 스캔을 실행할 로컬 자산 파일/디렉토리 절대 경로",
            },
          },
          required: ["assetPath"],
        },
      },
      {
        name: "get_sbom_summary",
        description: "현재 자산 DB에 기반한 SBOM 요약 보고서를 JSON 형태로 조회합니다.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// MCP 툴 실행 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "scan_asset") {
      const assetPath = args?.assetPath as string;
      if (!assetPath) {
        throw new Error("assetPath argument is required");
      }

      // 실제 비즈니스 로직 연동 (예: bridge를 통한 스캐너 어댑터 구동 등)
      // 여기서는 예시 응답을 반환하거나 실제 로직을 호출합니다.
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: `${assetPath} 스캔 완료`,
              findings: [
                {
                  finding_type: "Vulnerability",
                  severity: "HIGH",
                  evidence: "Plaintext credentials found in config",
                  source_tool: "ModelScan",
                },
              ],
            }),
          },
        ],
      };
    } else if (name === "get_sbom_summary") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              sbom_standard: "CycloneDX v1.5",
              components_count: 42,
              vulnerabilities: {
                critical: 0,
                high: 1,
                medium: 5,
                low: 12,
              },
            }),
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Stdio 전송 프로토콜로 MCP 서버 구동
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GIJO AS MCP Server running on stdio");
}

run().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
