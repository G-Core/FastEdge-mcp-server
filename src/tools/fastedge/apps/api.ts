import qs from "qs";

import {
  ApiConfig,
  CreateAppResource,
  GetAppResponse,
  GetAppsQueryParams,
  GetAppsResponse,
  UpdateAppResource,
} from "../types.js";

async function getApp(
  apiConfig: ApiConfig,
  id: string | number
): Promise<GetAppResponse> {
  try {
    const response = await fetch(`${apiConfig.apiUrl}/fastedge/v1/apps/${id}`, {
      method: "GET",
      headers: {
        Authorization: `APIKey ${apiConfig.apiKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const app = (await response.json()) as GetAppResponse;
    return {
      ...app,
      id: Number.parseInt(id.toString(), 10), // Ensure ID is included as a number
    };
  } catch (error) {
    throw new Error(
      `Error fetching application: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

async function getApps(
  apiConfig: ApiConfig,
  query: GetAppsQueryParams
): Promise<GetAppsResponse> {
  try {
    const queryString = qs.stringify(query, {
      skipNulls: true,
      addQueryPrefix: true,
    });
    const response = await fetch(
      `${apiConfig.apiUrl}/fastedge/v1/apps${queryString}`,
      {
        method: "GET",
        headers: {
          Authorization: `APIKey ${apiConfig.apiKey}`,
        },
      }
    );
    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(response.statusText);
    }
    const jsonResponse = (await response.json()) as Record<
      "apps",
      GetAppsResponse
    >;
    return jsonResponse.apps ?? [];
  } catch (error) {
    throw new Error(
      `Error fetching applications: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

async function getAppByName(
  apiConfig: ApiConfig,
  name: string
): Promise<GetAppResponse | null> {
  const apps = await getApps(apiConfig, { name });
  if (apps.length === 0) {
    return null;
  }
  return getApp(apiConfig, apps[0].id);
}

async function createApp(
  apiConfig: ApiConfig,
  app: CreateAppResource
): Promise<GetAppResponse> {
  try {
    const response = await fetch(`${apiConfig.apiUrl}/fastedge/v1/apps`, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${apiConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(app),
    });
    if (!response.ok) {
      // ? FIX: Figure out better error handling
      throw new Error(response.statusText);
    }
    return response.json() as Promise<GetAppResponse>;
  } catch (error) {
    throw new Error(
      `Error creating application: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

async function updateApp(
  apiConfig: ApiConfig,
  app: UpdateAppResource
): Promise<GetAppResponse> {
  try {
    const response = await fetch(
      `${apiConfig.apiUrl}/fastedge/v1/apps/${app.id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `APIKey ${apiConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(app),
      }
    );
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    return response.json() as Promise<GetAppResponse>;
  } catch (error) {
    throw new Error(
      `Error updating application: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

export { getApp, getApps, getAppByName, createApp, updateApp };
