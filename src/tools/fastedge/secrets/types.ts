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

export type {
  GetSecretsQueryParams,
  GetSecretsResponse,
  GetSecretsResponseItem,
};
