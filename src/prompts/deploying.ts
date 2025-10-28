import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import dedent from "dedent";

/**
 * Register deployment related prompts to the MCP server
 * @param server MCP Server instance
 */
export function registerDeploymentPrompts(server: McpServer) {
  server.registerPrompt(
    "deployFastEdgeApp",
    {
      title: "Deploy a FastEdge application",
      description:
        "Build and deploy a FastEdge application from the custom code in the active window",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                Build the current code into a wasm binary and deploy to the FastEdge network.
                ( Use any "Magic Comments" provided as inputs for all steps )
                PROCESS:
                1. Use build-wasm tool to create a wasm binary.
                2. Upload the wasm binary to the FastEdge network using the upload-binary tool. Keep track of the new binary id.
                3. Use the update-or-create-app tool to deploy this application to FastEdge.
                4. Check if the user wants to save the application data in Magic Comments?
                5. If so, use the deployment-comment tool to create them and insert them into the top of the active file (i.e. the entryFile from building).
              `,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "insertMagicComments",
    {
      title: "Generate Magic Comments for Deployment",
      description:
        "Generate Magic Comments for deployment tracking in a FastEdge application",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                I want to create FastEdge Deployment magic comments. Please help me insert the correct information:
                  1. **Application Name**: What is the name of the application?
                  2. **Wasm Ouput Path**: What is the filepath/name to the wasm output?
                  3. **Build Directory**: Is the workspace folder the build directory? If not, provide a relative path to it.

                Based on my answers or the correct defaults provided, use the deployment-comments tool to create the appropriate Magic Comments in the active file.
              `,
            },
          },
        ],
      };
    }
  );

  server.registerPrompt(
    "setEnvironmentVariables",
    {
      title: "Set Environment Variables on the FastEdge Application",
      description: "Set .env variables on the FastEdge application.",
    },
    async () => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: dedent`
                I want to collect all the dotenv variables required for my FastEdge application.
                Please read the "# FastEdge DotEnv Variables" section in the FastEdge context (get-fastedge-context) to understand what variables are available and how to use them.

                For each Secret found in a dotenv file, please use the get-secret-id tool to retrieve the secret's ID using the the secret_name ( value of the pair ).
                ( The update-env-vars-app tool requires id's for secrets, not the values. )

                PROCESS:
                1. Verify which entryFile and folder to be searching for dotenv variables from, i.e. where is my application's root directory.
                2. Collect all the "Environment Variables", "Secrets" and "Response Headers" for my application as per the FastEdge context "DotEnv Variables" information.
                3. Check that the user is happy with the values collected. (For secrets show the key, secret_name and collected id)
                4. Use the update-env-vars-app tool to set them on my FastEdge application.

                If no dotenv files are found, please inform me that this is likely due to .gitignore rules excluding them from search results.
                The user may need to provide the dotenv files as context or temporarily adjust their .gitignore to allow the MCP to read these files.

                Note: Check to see if my application uses any specific environment variables or secrets.
                  1. Warn me if any are missing.
                  2. If none are required then just set an empty object for that field and verify that I still want to run the update-env-vars-app tool.
              `,
            },
          },
        ],
      };
    }
  );
}
