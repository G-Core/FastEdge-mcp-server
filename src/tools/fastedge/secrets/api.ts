import {
  ApiConfig,
  GetSecretsResponse,
  GetSecretsResponseItem,
} from "../types.js";

async function getSecretByName(
  apiConfig: ApiConfig,
  name: string
): Promise<GetSecretsResponseItem | null> {
  try {
    const response = await fetch(
      `${apiConfig.apiUrl}/fastedge/v1/secrets?secret_name=${encodeURIComponent(
        name
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `APIKey ${apiConfig.apiKey}`,
        },
      }
    );
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(response.statusText);
    }
    const jsonResponse = (await response.json()) as Record<
      "secrets",
      GetSecretsResponse
    >;
    return jsonResponse.secrets?.[0] ?? null;
  } catch (error) {
    throw new Error(
      `Error fetching secret: ${error instanceof Error ? error.message : error}`
    );
  }
}

export { getSecretByName };
