import {
  ApiType,
  AppSecrets,
  GetBinaryResponse,
  OrderingParams,
  PaginationParams,
} from "../types.js";

/**
// * Apps Base Resource
**/

interface AppResource {
  id: number;
  api_type: ApiType;
  binary: number;
  comment: string;
  env: Record<string, string>;
  log: string;
  name: string;
  networks: Array<string>;
  plan: string;
  plan_id: number;
  rsp_headers: Record<string, string>;
  secrets: AppSecrets;
  status: number;
  template: number;
  template_name: string;
  url: string;
}

/**
// * Fetching Single App
**/

type GetAppResponse = Pick<
  AppResource,
  | "id"
  | "api_type"
  | "binary"
  | "comment"
  | "env"
  | "log"
  | "name"
  | "networks"
  | "plan"
  | "plan_id"
  | "rsp_headers"
  | "secrets"
  | "status"
  | "url"
> &
  Partial<Pick<AppResource, "template" | "template_name">>;

type GetAppResponseWithBinary = Omit<GetAppResponse, "binary"> & {
  binary: GetBinaryResponse;
};

/**
// * Fetching Apps List
**/

type AppsOrderingFields =
  | "binary"
  | "id"
  | "name"
  | "plan"
  | "status"
  | "template";

interface GetAppsQueryParams
  extends PaginationParams,
    OrderingParams<AppsOrderingFields> {
  api_type?: ApiType;
  name?: string;
  binary?: number;
  status?: number;
  plan?: number;
  template?: number;
}

type GetAppsResponseItem = Pick<
  AppResource,
  | "api_type"
  | "binary"
  | "comment"
  | "id"
  | "name"
  | "networks"
  | "plan"
  | "plan_id"
  | "status"
  | "url"
>;

type GetAppsResponse = Array<GetAppsResponseItem>;

/**
// * Create App
**/

type CreateAppBase = Pick<
  AppResource,
  "status" | "env" | "rsp_headers" | "secrets" | "comment"
> &
  Partial<Pick<AppResource, "name">>;

type CreateAppResource = CreateAppBase & Pick<AppResource, "binary">;

type CreateAppResponse = Pick<
  AppResource,
  "id" | "api_type" | "binary" | "name" | "url" | "status" | "plan" | "plan_id"
>;

/**
// * Update App
**/

type UpdateAppResource = Pick<
  AppResource,
  | "id"
  | "binary"
  | "comment"
  | "status"
  | "env"
  | "rsp_headers"
  | "secrets"
  | "comment"
> &
  Partial<Pick<AppResource, "name">>;

type UpdateAppResponse = CreateAppResponse;

export type {
  CreateAppResource,
  CreateAppResponse,
  GetAppResponse,
  GetAppResponseWithBinary,
  GetAppsQueryParams,
  GetAppsResponse,
  GetAppsResponseItem,
  UpdateAppResource,
  UpdateAppResponse,
};
