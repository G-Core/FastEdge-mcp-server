# FastEdge Examples

FastEdge is a WebAssembly-based edge computing platform that enables developers to run applications at the edge of G-Core's CDN network. This repository contains comprehensive examples demonstrating how to build edge applications using JavaScript, Rust, and AssemblyScript. The examples cover common edge computing patterns including geo-routing, A/B testing, authentication, static asset serving, and MCP server implementation.

The examples are organized into three language-specific sections with complete build pipelines and deployment workflows. Each example includes production-ready code with proper error handling, environment variable management, and security best practices. The JavaScript examples use the FastEdge SDK to compile to WebAssembly, Rust examples leverage the Proxy-Wasm spec and FastEdge Rust SDK, and AssemblyScript examples utilize the proxy-wasm-sdk-as package.

## JavaScript Geo Redirect

Location-based request routing using geo-IP headers

```javascript
import { getEnv } from "fastedge::env";

async function eventHandler({ request }) {
  const baseOrigin = getEnv("BASE_ORIGIN");

  if (!baseOrigin) {
    return new Response("BASE_ORIGIN environment variable is not set", {
      status: 500,
    });
  }

  const countryCode = request.headers.get("geoip-country-code");
  const customOrigin = getEnv(countryCode);
  const redirectOrigin = customOrigin ?? baseOrigin;

  return Response.redirect(redirectOrigin, 302);
}

addEventListener("fetch", (event) => {
  event.respondWith(eventHandler(event));
});
```

Environment variables:
- `BASE_ORIGIN=https://default-site.com`
- `US=https://us-site.com`
- `GB=https://uk-site.com`

Build: `npm run build geo-redirect`

## JavaScript A/B Testing

Cookie-based A/B testing with weighted variant distribution

```javascript
import { getEnv } from "fastedge::env";

const testConfig = {
  logo: [
    { variant: "hops", weight: 50 },
    { variant: "bottle", weight: 50 },
  ],
  font: [
    { variant: "exo2", weight: 40 },
    { variant: "gloria", weight: 65 },
    { variant: "standard", weight: 45 },
  ],
};

async function eventHandler({ request }) {
  const [xid, slicedHeaders] = sliceAbTestIdFromCookie(request);
  const headers = createAbTestHeaders(slicedHeaders, testConfig, xid);
  const downstreamUrl = getEnv("DOWNSTREAM_URL");
  const response = await fetch(downstreamUrl, { headers });

  const resHeaders = new Headers(response.headers);
  resHeaders.set(
    "set-cookie",
    `x-fastedge-abid=${xid}; Max-Age: 31536000; Path=/;`
  );

  return new Response(response.body, {
    status: response.status,
    headers: resHeaders,
  });
}

addEventListener("fetch", (event) => {
  event.respondWith(eventHandler(event));
});

const sliceAbTestIdFromCookie = ({ headers: reqHeaders }) => {
  const headers = new Headers(reqHeaders);
  const cookie = headers.get("cookie") || "";
  const xid = (cookie.match(
    /(?:^|;) *x-fastedge-abid=((0|1|)\.\d+) *(?:;|$)/
  ) || [])[1];

  if (xid) {
    const newCookie = cookie.replace(/x-fastedge-abid=[^;]+;?\s*/g, "");
    if (newCookie) {
      headers.set("cookie", newCookie);
    } else {
      headers.delete("cookie");
    }
    return [xid, headers];
  }

  const randomXid = `${Math.random()}`.slice(1, 5);
  return [randomXid, headers];
};

const forceWeightsToPercentages = (testValues) => {
  let total = testValues.reduce((acc, { weight }) => acc + weight, 0);
  return testValues.map(({ variant, weight }) => ({
    variant,
    percentage: (weight / total) * 100,
  }));
};

const createAbTestHeaders = (reqHeaders, testConfig, xid) => {
  const headers = new Headers(reqHeaders);
  Object.keys(testConfig).forEach((testName) => {
    const xidPercentage = parseFloat(xid) * 100;
    const testValues = forceWeightsToPercentages(testConfig[testName]);
    let start = 0;
    for (const { variant, percentage } of testValues) {
      const end = start + percentage;
      if (xidPercentage >= start && xidPercentage < end) {
        headers.set(`ab-test-${testName}`, variant);
        break;
      }
      start = end;
    }
  });
  return headers;
};
```

Environment variables:
- `DOWNSTREAM_URL=https://backend.example.com`

Downstream receives headers: `ab-test-logo: hops`, `ab-test-font: gloria`

## JavaScript Static Assets Server

Compile-time static file embedding with Hono framework

```typescript
import { Hono } from "hono";
import { createStaticServer } from "@gcoredev/fastedge-sdk-js";
import { staticAssetManifest as imagesStaticAssets } from "./images-static-assets";
import { staticAssetManifest as stylesStaticAssets } from "./styles-static-assets";
import { staticAssetManifest as templatesStaticAssets } from "./templates-static-assets";

const imagesStaticServer = createStaticServer(imagesStaticAssets, {
  routePrefix: "images",
});

const stylesStaticServer = createStaticServer(stylesStaticAssets, {
  routePrefix: "styles",
});

const templatesStaticServer = createStaticServer(templatesStaticAssets, {});

const app = new Hono();

app.get("/", async (c) => {
  return c.html(
    <html>
      <head>
        <title>Test Site</title>
        <link rel="stylesheet" href="/styles/index.css"></link>
      </head>
      <body>
        <h1>Home Page</h1>
        <p>Basic HTML rendering</p>
        <div class="nav-link">
          <a href="/jsx">Go to React JSX Page</a>
        </div>
        <div class="nav-link">
          <a href="/template">Template String Page</a>
        </div>
      </body>
    </html>
  );
});

app.get("/styles/*", async (c) => {
  return stylesStaticServer.serveRequest(c.req.raw);
});

app.get("/images/*", async (c) => {
  return imagesStaticServer.serveRequest(c.req.raw);
});

app.get("/template", async (c) => {
  const templateString = await templatesStaticServer.readFileString(
    "/index.html"
  );
  return c.html(templateString);
});

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(app.fetch(event.request));
});
```

Generate manifest: `npx fastedge-assets ./images ./src/images-static-assets.ts`

Build: `npm run build && npx fastedge-build --input build/index.js --output build/app.wasm`

## JavaScript MCP Server

Model Context Protocol weather server using Hono transport

```typescript
// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const NWS_API_BASE = "https://api.weather.gov";
const USER_AGENT = "weather-app/1.0";

const server = new McpServer({
  name: "weather",
  version: "1.0.0",
});

async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/geo+json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making NWS request:", error);
    return null;
  }
}

server.tool(
  "get_forecast",
  "Get weather forecast for a location",
  {
    latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude of the location"),
  },
  async ({ latitude, longitude }) => {
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(
      4
    )},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl);

    if (!pointsData) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}`,
          },
        ],
      };
    }

    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to get forecast URL from grid point data",
          },
        ],
      };
    }

    const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl);
    if (!forecastData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve forecast data",
          },
        ],
      };
    }

    const periods = forecastData.properties?.periods || [];
    const formattedForecast = periods.map((period: ForecastPeriod) =>
      [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${
          period.temperatureUnit || "F"
        }`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
      ].join("\n")
    );

    return {
      content: [
        {
          type: "text",
          text: `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join(
            "\n"
          )}`,
        },
      ],
    };
  }
);

export default server;

// src/index.ts
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import server from "./server.js";

const router = new Hono();

router.all("/mcp", async (c) => {
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

addEventListener("fetch", (event: FetchEvent) => {
  event.respondWith(router.fetch(event.request));
});
```

VSCode configuration (`.vscode/mcp.json`):
```json
{
  "servers": {
    "weather-mcp-server": {
      "type": "http",
      "url": "https://weather-mcp-123456.fastedge.app/mcp"
    }
  }
}
```

Build: `npm run build`

## Rust Geo Blocking with Time Windows

CDN application blocking requests from blacklisted countries with optional time windows

```rust
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};
use proxy_wasm::traits::*;
use proxy_wasm::types::*;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}

struct HttpHeadersRoot;

impl Context for HttpHeadersRoot {}

impl RootContext for HttpHeadersRoot {
    fn create_http_context(&self, _context_id: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(HttpHeaders {}))
    }

    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
}

struct HttpHeaders {}

impl Context for HttpHeaders {}

const BAD_GATEWAY: u32 = 502;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;

impl HttpContext for HttpHeaders {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let Ok(blacklist) = env::var("BLACKLIST") else {
            self.send_http_response(INTERNAL_SERVER_ERROR, vec![], Some(b"App misconfigured"));
            return Action::Pause;
        };

        let mut blacklist = blacklist.split(',');

        let Some(country) = self.get_property(vec!["request.country"]) else {
            self.send_http_response(BAD_GATEWAY, vec![], Some(b"Malformed request - no country field"));
            return Action::Pause;
        };

        let Ok(country) = std::str::from_utf8(&country) else {
            self.send_http_response(BAD_GATEWAY, vec![], Some(b"Malformed request - country not utf8 string"));
            return Action::Pause;
        };

        if blacklist.any(|b| country.eq_ignore_ascii_case(b)) {
            let tw_start = env::var("BLACKLIST_TW_START").ok();
            let tw_end = env::var("BLACKLIST_TW_END").ok();

            if let Some((tw_start, tw_end)) = tw_start.zip(tw_end) {
                let Ok(tw_start) = tw_start.parse::<u64>() else {
                    self.send_http_response(INTERNAL_SERVER_ERROR, vec![], Some(b"App misconfigured"));
                    return Action::Pause;
                };

                let Ok(tw_end) = tw_end.parse::<u64>() else {
                    self.send_http_response(INTERNAL_SERVER_ERROR, vec![], Some(b"App misconfigured"));
                    return Action::Pause;
                };

                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();

                if now > tw_start || now <= tw_end {
                    self.send_http_response(FORBIDDEN, vec![], Some(b"Request blacklisted"));
                    return Action::Pause;
                }
            } else {
                self.send_http_response(FORBIDDEN, vec![], Some(b"Request blacklisted"));
                return Action::Pause;
            }
        }

        Action::Continue
    }
}
```

Environment variables:
- `BLACKLIST=CN,RU,KP`
- `BLACKLIST_TW_START=1704067200` (optional)
- `BLACKLIST_TW_END=1704153600` (optional)

Build: `cargo build --release --target wasm32-wasi`

## Rust JWT Validation

CDN application validating JWT tokens with secret management

```rust
use std::time::{SystemTime, UNIX_EPOCH};
use headers::HeaderValue;
use headers::authorization::{Bearer, Credentials};
use fastedge::proxywasm::secret;
use jsonwebtoken::{decode, DecodingKey, Validation};
use proxy_wasm::traits::*;
use proxy_wasm::types::*;
use serde::Deserialize;

proxy_wasm::main! {{
    proxy_wasm::set_log_level(LogLevel::Trace);
    proxy_wasm::set_root_context(|_| -> Box<dyn RootContext> { Box::new(HttpHeadersRoot) });
}}

struct HttpHeadersRoot;

impl Context for HttpHeadersRoot {}

impl RootContext for HttpHeadersRoot {
    fn create_http_context(&self, _context_id: u32) -> Option<Box<dyn HttpContext>> {
        Some(Box::new(HttpHeaders {}))
    }

    fn get_type(&self) -> Option<ContextType> {
        Some(ContextType::HttpContext)
    }
}

struct HttpHeaders {}

impl Context for HttpHeaders {}

const UNAUTHORIZED: u32 = 401;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;

#[derive(Debug, Deserialize, Default)]
struct Claims {
    exp: u64,
}

impl HttpContext for HttpHeaders {
    fn on_http_request_headers(&mut self, _: usize, _: bool) -> Action {
        let Ok(Some(secret)) = secret::get("secret") else {
            println!("'secret' param not set");
            self.send_http_response(INTERNAL_SERVER_ERROR, vec![], Some(b"App misconfigured"));
            return Action::Pause;
        };

        let Some(value) = self.get_http_request_header("Authorization") else {
            println!("No auth header");
            self.send_http_response(UNAUTHORIZED, vec![], Some(b"No Authorization header"));
            return Action::Pause;
        };

        if value.is_empty() {
            println!("Auth header is empty");
            self.send_http_response(UNAUTHORIZED, vec![], Some(b"No Authorization header"));
            return Action::Pause;
        };

        let Ok(header) = value.parse::<HeaderValue>() else {
            println!("Auth header is invalid");
            self.send_http_response(UNAUTHORIZED, vec![], Some(b"Invalid Authorization header"));
            return Action::Pause;
        };

        let Some(bearer) = Bearer::decode(&header) else {
            println!("Auth header doesn't contain token");
            self.send_http_response(FORBIDDEN, vec![], Some(b"Token not found"));
            return Action::Pause;
        };

        let token = bearer.token();

        let decoding_key = DecodingKey::from_secret(&secret);
        let mut validation = Validation::default();
        validation.set_required_spec_claims(&["exp"]);
        validation.validate_aud = false;
        validation.validate_nbf = false;
        validation.validate_exp = false;

        let token_data = match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => token_data,
            Err(error) => {
                println!("Token is invalid");
                self.send_http_response(FORBIDDEN, vec![], Some(format!("Could not decode token {}: {}", token, error).as_bytes()));
                return Action::Pause;
            }
        };

        let claims = token_data.claims;

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if now > claims.exp {
            println!("Token expired");
            self.send_http_response(FORBIDDEN, vec![], Some(b"Token expired"));
            return Action::Pause;
        }

        println!("Token ok");
        Action::Continue
    }
}
```

Secret configuration via FastEdge Portal:
- Secret name: `secret`
- Value: HMAC signing key (base64)

Request: `curl -H "Authorization: Bearer eyJhbGc..." https://app.fastedge.app/`

Build: `cargo build --release --target wasm32-wasi`

## Rust S3 Upload

HTTP application proxying file uploads to S3 with size limits

```rust
use std::time::Duration;
use fastedge::{
    body::Body,
    http::{header, Error, Method, Request, Response, StatusCode},
};
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use std::{collections::HashMap, env};
use url::Url;

#[fastedge::http]
fn main(req: Request<Body>) -> Result<Response<Body>, Error> {
    match req.method() {
        &Method::POST | &Method::PUT => (),

        &Method::OPTIONS => {
            return Response::builder()
                .status(StatusCode::NO_CONTENT)
                .body(Body::empty());
        }

        _ => {
            return Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .header(header::ALLOW, "PUT, POST")
                .body(Body::from("This method is not allowed\n"));
        }
    };

    let query_pairs = |q: &str| {
        q.split('&')
            .filter_map(|q| {
                let mut i = q.splitn(2, '=');
                let k = i.next()?;
                let v = i.next()?;
                Some((k, v))
            })
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect::<HashMap<String, String>>()
    };
    let hash_query: HashMap<String, String> = req.uri().query().map_or(HashMap::new(), query_pairs);

    let fname = match hash_query.get("name") {
        None => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Malformed request\n"))
        }
        Some(i) => i,
    };

    if req.body().is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Body::from("Malformed request\n"));
    }

    let content_type = match req.headers().get("Content-Type") {
        None => "application/octet-stream",
        Some(v) => v.to_str().unwrap(),
    };
    let content_type = content_type.to_owned();
    let content = req.into_body();

    match env::var("MAX_FILE_SIZE").ok() {
        None => {}
        Some(l) => match l.parse::<usize>() {
            Err(_) => {}
            Ok(v) => {
                if content.len() > v {
                    let msg = format!("File exceeds allowed limit of {} bytes\n", v);
                    return Response::builder()
                        .status(StatusCode::PAYLOAD_TOO_LARGE)
                        .body(Body::from(msg.as_str().to_owned()));
                }
            }
        },
    }

    let (signed_url, host) = match prepare_s3(fname) {
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("App misconfigured\n"))
        }
        Ok((u, h)) => (u, h),
    };

    let out_req = Request::builder()
        .method(Method::PUT)
        .uri(signed_url.as_str())
        .header("Host", host)
        .header("Accept-Encoding", "identity")
        .header("Content-Length", content.len().to_string())
        .header("Content-Type", content_type);

    let Ok(req) = out_req.body(content) else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("Malformed request\n"));
    };

    let rsp = match fastedge::send_request(req) {
        Err(_) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::empty())
        }
        Ok(r) => r,
    };

    let (parts, body) = rsp.into_parts();
    let body = if parts.status == StatusCode::OK {
        let mut tmp_url = signed_url.clone();
        tmp_url.set_query(None);
        Body::from(tmp_url.to_string())
    } else {
        body
    };
    Ok(Response::from_parts(parts, body))
}

fn prepare_s3(fname: &str) -> anyhow::Result<(Url, String)> {
    let access_key = env::var("ACCESS_KEY")?;
    let secret_key = env::var("SECRET_KEY")?;
    let region = env::var("REGION")?;
    let base_hostname = env::var("BASE_HOSTNAME")?;
    let bucket = env::var("BUCKET")?;
    let scheme = env::var("SCHEME").unwrap_or_else(|_| "http".to_string());

    let host = region.clone() + "." + base_hostname.as_str();
    let upload_url = scheme + "://" + host.as_str();
    let parsed_url = upload_url.parse()?;
    let bucket = Bucket::new(parsed_url, UrlStyle::Path, bucket, region)?;

    let creds = Credentials::new(access_key, secret_key);
    let action = bucket.put_object(Some(&creds), fname);
    let signed_url = action.sign(Duration::from_secs(60 * 60));

    Ok((signed_url, host))
}
```

Environment variables:
- `ACCESS_KEY=AKIAIOSFODNN7EXAMPLE`
- `SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`
- `REGION=us-west-2`
- `BASE_HOSTNAME=s3.amazonaws.com`
- `BUCKET=my-bucket`
- `SCHEME=https`
- `MAX_FILE_SIZE=5242880` (5MB, optional)

Request: `curl -X POST "https://upload.fastedge.app?name=file.jpg" -H "Content-Type: image/jpeg" --data-binary @photo.jpg`

Response: `https://us-west-2.s3.amazonaws.com/my-bucket/file.jpg`

Build: `cargo build --release --target wasm32-wasi`

## AssemblyScript Geo Blocking

CDN application blocking requests from blacklisted countries using proxy-wasm-sdk-as

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  get_property,
  getEnvVar,
  registerRootContext,
  RootContext,
  send_http_response,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

const BAD_GATEWAY: u32 = 502;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;

class GeoBlockRoot extends RootContext {
  createContext(context_id: u32): Context {
    return new GeoBlock(context_id, this);
  }
}

class GeoBlock extends Context {
  allow: bool = true;

  constructor(context_id: u32, root_context: GeoBlockRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const blacklist = getEnvVar("BLACKLIST");
    if (!blacklist) {
      send_http_response(
        INTERNAL_SERVER_ERROR,
        "internal server error",
        String.UTF8.encode("App misconfigured"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const blacklistedCountries = blacklist
      .split(",")
      .map<string>((c) => c.trim());

    if (blacklistedCountries.length === 0) {
      send_http_response(
        INTERNAL_SERVER_ERROR,
        "internal server error",
        String.UTF8.encode("App misconfigured"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const country = get_property("request.country");
    if (country.byteLength === 0) {
      send_http_response(
        BAD_GATEWAY,
        "internal server error",
        String.UTF8.encode("Missing country information"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const countryStr = String.UTF8.decode(country);
    if (blacklistedCountries.includes(countryStr)) {
      send_http_response(
        FORBIDDEN,
        "forbidden",
        String.UTF8.encode("Request blacklisted"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new GeoBlockRoot(context_id);
}, "geoblock");
```

Environment variables:
- `BLACKLIST=CN,RU,KP`

Build: `npm run build:geoBlock`

## AssemblyScript JWT Validation

CDN application validating JWT tokens using as-jwt library

```typescript
export * from "@gcoredev/proxy-wasm-sdk-as/assembly/proxy";
import {
  Context,
  FilterHeadersStatusValues,
  getSecretVar,
  log,
  LogLevelValues,
  registerRootContext,
  RootContext,
  send_http_response,
  setLogLevel,
  stream_context,
} from "@gcoredev/proxy-wasm-sdk-as/assembly";

import { jwtVerify, JwtValidation } from "@gcoredev/as-jwt/assembly";

const UNAUTHORIZED: u32 = 401;
const FORBIDDEN: u32 = 403;
const INTERNAL_SERVER_ERROR: u32 = 500;

class AuthRoot extends RootContext {
  createContext(context_id: u32): Context {
    setLogLevel(LogLevelValues.info);
    return new Auth(context_id, this);
  }
}

class Auth extends Context {
  allow: bool = false;

  constructor(context_id: u32, root_context: AuthRoot) {
    super(context_id, root_context);
  }

  onRequestHeaders(a: u32, end_of_stream: bool): FilterHeadersStatusValues {
    const secret = getSecretVar("secret");
    if (!secret) {
      send_http_response(
        INTERNAL_SERVER_ERROR,
        "internal server error",
        String.UTF8.encode("App misconfigured"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const authHeader = stream_context.headers.request.get("Authorization");
    if (!authHeader) {
      send_http_response(
        UNAUTHORIZED,
        "unauthorized",
        String.UTF8.encode("No Authorization header"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    if (authHeader.length == 0) {
      send_http_response(
        UNAUTHORIZED,
        "unauthorized",
        String.UTF8.encode("No Authorization header"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      send_http_response(
        UNAUTHORIZED,
        "unauthorized",
        String.UTF8.encode("Token not found"),
        []
      );
      return FilterHeadersStatusValues.StopIteration;
    }

    const jwtResult = jwtVerify(token, secret);
    if (jwtResult !== JwtValidation.Ok) {
      if (jwtResult === JwtValidation.Expired) {
        log(LogLevelValues.info, "Token Expired");
        send_http_response(
          FORBIDDEN,
          "forbidden",
          String.UTF8.encode("Expired token"),
          []
        );
      } else {
        log(LogLevelValues.info, "Bad Token");
        send_http_response(
          FORBIDDEN,
          "forbidden",
          String.UTF8.encode("Invalid token"),
          []
        );
      }
      return FilterHeadersStatusValues.StopIteration;
    }
    return FilterHeadersStatusValues.Continue;
  }
}

registerRootContext((context_id: u32) => {
  return new AuthRoot(context_id);
}, "auth");
```

Secret configuration via FastEdge Portal:
- Secret name: `secret`
- Value: HMAC signing key

Request: `curl -H "Authorization: Bearer eyJhbGc..." https://app.fastedge.app/`

Build: `npm run build:jwt`

## GitHub Actions Deployment

CI/CD workflow for FastEdge application deployment

```yaml
name: Deploy FastEdge Application

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Build application
        run: npm run build:first-app

      - name: Deploy to FastEdge
        uses: gcore-github-actions/fastedge@v1
        with:
          api-token: ${{ secrets.FASTEDGE_API_TOKEN }}
          app-name: 'my-app'
          wasm-path: './dist/first-app.wasm'
          environment-variables: |
            BASE_ORIGIN=https://example.com
            US=https://us.example.com
          response-headers: |
            X-Custom-Header: value
            Access-Control-Allow-Origin: *
          secret-slots: ${{ secrets.SECRET_SLOTS }}
```

Secret configuration in GitHub Settings:
- `FASTEDGE_API_TOKEN`: API authentication token
- `SECRET_SLOTS`: JSON array of secret values for slot-based rotation

Multi-app workflow with release artifacts:
```yaml
name: Multi-App Release

on:
  release:
    types: [created]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app: [first-app, second-app]
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      - name: Build ${{ matrix.app }}
        run: npm run build:${{ matrix.app }}

      - name: Upload to release
        uses: actions/upload-release-asset@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          upload_url: ${{ github.event.release.upload_url }}
          asset_path: ./dist/${{ matrix.app }}.wasm
          asset_name: ${{ matrix.app }}.wasm
          asset_content_type: application/wasm

      - name: Deploy to FastEdge
        uses: gcore-github-actions/fastedge@v1
        with:
          api-token: ${{ secrets.FASTEDGE_API_TOKEN }}
          app-name: ${{ matrix.app }}
          wasm-path: ./dist/${{ matrix.app }}.wasm
```

## Summary

These examples demonstrate the breadth of edge computing use cases supported by FastEdge across three programming languages. JavaScript examples showcase modern web frameworks like Hono and integration with Model Context Protocol for AI applications. Rust examples provide high-performance solutions for authentication and cloud storage integration with robust error handling. AssemblyScript examples offer a lightweight alternative for CDN applications using the Proxy-Wasm specification.

All examples follow production-ready patterns including environment variable configuration, secret management, comprehensive error handling, and proper HTTP status codes. The repository includes complete CI/CD workflows using GitHub Actions for automated deployment to the FastEdge platform. Build tools are optimized for WebAssembly compilation with support for local testing via FastEdge-runner and the FastEdge Launcher VSCode extension. Each example can be deployed independently or combined to create sophisticated edge computing architectures.
