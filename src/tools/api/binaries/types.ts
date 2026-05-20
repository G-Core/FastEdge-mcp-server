type ApiType = "wasi-http" | "proxy-wasm";

interface UploadBinaryResponse {
  id: number;
  api_type: ApiType;
  checksum: string;
  status: number;
  unref_since: string;
}

export type { ApiType, UploadBinaryResponse };
