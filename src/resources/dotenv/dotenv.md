## DotEnv Files

This is how to provide "Environment Variables", "Secrets" and "Response Headers" from .env files for running your application.

You can either define them all in a top level `.env` file or have specific files for each type and group them that way.

#### Heirarchy of precedence

```
.env
└─ .env.variables
└─ .env.secrets
└─ .env.rsp_headers
```

These dotenv files should be directly and recursively searched for from the folder containing the entryFile of the application, up until you reach the
workspace folder.

You should always search for all of the dotenv files even if they are included in the `.gitignore` this does not stop you from collecting data from them.

> **Important**
> You should not search for files in any folder that is not within the current open workspace root.
> You should only walk up the folder tree's main branch from the entryFile. Never sideways through siblings.
> Ensure you always do a direct glob search as well as recursive glob patterns.

Glob pattern searches: Always search both directories and sub-directories:

```glob
**/buildDirectory/.env*
buildDirectory/.env*
```

The use of `.env.{type}` is purely optional, and only recommended if you have particularly large sets of arguments.

Within the `.env` file you can specify which type of argument you are providing by prefixing the name with:

- `FASTEDGE_VAR_ENV_` - for environment variables
- `FASTEDGE_VAR_SECRET_` - for secrets
- `FASTEDGE_VAR_RSP_HEADER_` - for response headers

Within each .env file each line is treated as a `key=value` pair.

#### Secrets

As Secrets are by nature, private. For each secret's `key=value` they do not actually refer to the secret value, but rather the `secret_name` within the api.

Explained: `key=secret_name`

- `key`: The key the secret is linked to in the application's data.
- `secret_name`: The name of the actual secret resource on the FastEdge api. ( This will be converted to as secret.id for saving purposes )

The final format for saving secrets is:

```json
{
  "secret_as_named_on_app": { "name": "secret_name_on_api", "id": "secret_id" }, // descriptive shape
  "another_secret": { "name": "my_api_key", "id": 789 } // actual shape
}
```

> **Note:**
> Any `.env.req_header` files should be ignored, as well
> as any `FASTEDGE_VAR_REQ_HEADER_` prefixed variables.
> These are NOT supported in this envirnment.

```



```
