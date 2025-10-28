/**
// * Secrets Base Resource
**/

interface SecretSlots {
  slot: number;
  value?: string;
  checksum?: string;
}

interface Secret {
  id: number;
  name: string;
  app_count: number;
  comment: string;
  secret_slots: Array<SecretSlots>;
}

/**
 // * List secrets
 */
interface GetSecretsQueryParams {
  app_id?: number;
  secret_name?: string;
}

type GetSecretsResponseItem = Pick<
  Secret,
  "id" | "name" | "app_count" | "comment"
>;

type GetSecretsResponse = Array<GetSecretsResponseItem>;

/**
 // * App secrets type used in the application resource.
 */

type AppSecrets = Record<
  string,
  Pick<Secret, "id"> & Partial<Pick<Secret, "name" | "comment">>
>;

export type {
  AppSecrets,
  GetSecretsQueryParams,
  GetSecretsResponse,
  GetSecretsResponseItem,
};
