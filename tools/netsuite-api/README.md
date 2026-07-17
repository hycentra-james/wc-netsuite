# NetSuite API Client for Claude Code

Node.js client for accessing NetSuite data via OAuth 2.0 M2M (Machine-to-Machine) authentication.

## Live-data retrieval - 2026-07-08 incident and fix

**Symptom:** every call (ping, suiteql) returned:
```json
{"error":{"code":"SSS_INVALID_SCRIPTLET_ID","message":"That Suitelet is invalid, disabled, or no longer exists."}}
```
This is what a prior session saw as "no live NetSuite access" during WC-549 G2 verification.

**Root cause:** the client only ever called the custom RESTlet (`claudeCodeAPI_RL.js`,
`script=customscript_hyc_claude_code_api_rl&deploy=customdeploy_hyc_claude_code_api_r`). That
deployment no longer resolves in production. Confirmed it is NOT a typo in this repo: the same
error came back for both the scriptid/deployid strings above and the numeric ids this README
used to document (`2111` / `1`). The OAuth/JWT/M2M setup itself is completely fine - token
exchange succeeds every time for both the `restlets` and `rest_webservices` scopes, so the
Integration record, Client ID, Certificate ID, and RSA key are all correctly configured. The
custom RESTlet's script/deployment record itself is missing, disabled, or was deleted - this can
only be confirmed/fixed by an admin logging into NetSuite (Customization > Scripting > Scripts,
search "Claude Code API" / `claudeCodeAPI_RL`) since API calls can't discover their own broken
deployment id.

**Fix applied:** `netsuite-client.js` now bypasses the broken custom RESTlet entirely and talks
to NetSuite's native REST platform endpoints instead, using an OAuth token with scope
`rest_webservices`:
- SuiteQL: `POST /services/rest/query/v1/suiteql`
- Record read: `GET /services/rest/record/v1/{recordType}/{id}`

These are standard NetSuite endpoints (not a custom script), so there's no deployment to break.
Verified working against production account 6511399 on 2026-07-08 (`ping`, arbitrary `suiteql`,
and `getRecord` for both a kit item and a component all returned real data).

**Known gap (still needs the custom RESTlet, or NetSuite UI access):**
- On-hand/available inventory quantity (`locationquantityavailable` / `locationquantityonhand`)
  is a computed Item-search column, not exposed as a plain field via native REST - it needs
  `search.lookupFields`/`search.load` (RESTlet) or a saved search read via NetSuite's UI/CSV export.
  The SuiteQL `inventorybalance` table only has rows for items that currently carry a bin/lot
  balance (zero rows = zero on-hand for a lot-tracked item, but this hasn't been double-checked
  against a non-zero-stock item).
- Executing an existing saved search by internal ID (`search.load({id: 'customsearch_xxx'})`)
  isn't available via native REST at all.

### Restore checklist (for James - recreating the "Claude Code API" RESTlet deployment)

`netsuite-client.js` already points the legacy path at `script=customscript_hyc_claude_code_api_rl`
and `deploy=customdeploy_hyc_claude_code_api_r` (see `CONFIG.scriptId` / `CONFIG.deployId`) and
that code path (`runSearch`, `lookupFields`, plus the write helpers `createRecord`/`updateRecord`)
is untouched and ready to go - **no code change is needed once the deployment resolves again**;
`lookupFields`/`search` will just start working. Only the ids/roles below need to exist in
NetSuite for that to happen:

1. **Account**: `6511399` (this is the account the token endpoint and REST API host already
   target - `https://6511399.suitetalk.api.netsuite.com/...`).
2. **Script record**: Customization > Scripting > Scripts > confirm/create a Restlet script
   record pointing at `src/FileCabinet/SuiteScripts/Hycentra/Integrations/API/claudeCodeAPI_RL.js`,
   with **Script ID** = `customscript_hyc_claude_code_api_rl`.
3. **Deployment record**: under that script, confirm/create a deployment with **Deployment ID**
   = `customdeploy_hyc_claude_code_api_r`:
   - Status = **Released**
   - Log Level = Debug (or whatever's normal for this account)
   - **Audience/Roles**: must include the role used in the M2M certificate mapping (Setup >
     Integration > OAuth 2.0 Client Credentials (M2M) Setup - check which Entity/Role the
     "Claude Code API" mapping uses, e.g. Administrator) - if the deployment's audience doesn't
     include that role, calls will fail with an "Insufficient Permissions" style error even
     though the deployment itself resolves.
4. **Integration record scopes** (Setup > Integration > Manage Integrations > "Claude Code API"):
   confirm **RESTLETS** scope is still checked (needed for the legacy path; **REST WEB SERVICES**
   is what the current native-REST fix relies on and was already confirmed enabled since that
   path works today).
5. **Verify**: `node netsuite-client.js lookup inventoryitem <any known item internal id>
   custitem_fmt_next_receipt_date` - if that returns real field data instead of
   `SSS_INVALID_SCRIPTLET_ID`, the deployment is fixed. Also try
   `node netsuite-client.js search <a real saved search internal id>` to confirm saved-search
   execution works.

This is a production config change - if the Script/Deployment records already exist and just need
the ids reconciled (rather than being created fresh), double check the ACTUAL internal ids in the
UI match `customscript_hyc_claude_code_api_rl` / `customdeploy_hyc_claude_code_api_r` before
assuming a fresh deployment is required - it's possible the deployment exists under different ids
than this repo currently references, in which case update `CONFIG.scriptId` / `CONFIG.deployId`
in `netsuite-client.js` to match reality rather than recreating it.

## Quick Start

```bash
cd tools/netsuite-api

# Test connectivity
node netsuite-client.js ping

# Run a SuiteQL query
node netsuite-client.js suiteql "SELECT id, companyname FROM customer FETCH FIRST 10 ROWS ONLY"
```

## Commands

| Command | Path | Description | Example |
|---------|------|-------------|---------|
| `ping` | Native REST (working) | Test connectivity | `node netsuite-client.js ping` |
| `suiteql <query>` | Native REST (working) | Execute SuiteQL query | `node netsuite-client.js suiteql "SELECT id FROM customer"` |
| `getRecord <type> <id>` | Native REST (working) | Get full record (with expanded sublists) | `node netsuite-client.js getRecord salesorder 12345` |
| `lookup <type> <id> <fields...>` | Legacy RESTlet (broken - see incident above) | Lookup specific fields incl. computed columns like `locationquantityavailable` | `node netsuite-client.js lookup customer 330 companyname email` |
| `search <searchId>` | Legacy RESTlet (broken - see incident above) | Run saved search by internal id | `node netsuite-client.js search customsearch_my_search` |

## Common SuiteQL Queries

```bash
# List customers
node netsuite-client.js suiteql "SELECT id, companyname, email FROM customer WHERE isinactive = 'F' FETCH FIRST 20 ROWS ONLY"

# List recent sales orders
node netsuite-client.js suiteql "SELECT id, tranid, entity, total, trandate FROM transaction WHERE type = 'SalesOrd' ORDER BY id DESC FETCH FIRST 20 ROWS ONLY"

# Get inventory levels
node netsuite-client.js suiteql "SELECT item, location, quantityavailable, quantityonhand FROM inventorybalance FETCH FIRST 50 ROWS ONLY"

# List items
node netsuite-client.js suiteql "SELECT id, itemid, displayname, baseprice FROM item WHERE isinactive = 'F' FETCH FIRST 20 ROWS ONLY"
```

## Architecture

Two independent paths, same OAuth M2M credentials, different token scope:

```
                                   ┌─────────────────────────────────────┐
                                   │  scope=rest_webservices              │
┌─────────────────┐     ┌─────────┴─────────┐     ┌───────────────────┐ │
│  Claude Code    │────▶│  netsuite-client   │────▶│  Native REST API   │◀┘
│  (CLI/Skill)    │     │  (OAuth 2.0 M2M)   │     │  (SuiteQL/Record)  │   WORKING
│                 │     │                    │     └───────────────────┘
│                 │     │                    │     ┌───────────────────┐
│                 │     └─────────┬──────────┘────▶│  Legacy RESTlet    │   BROKEN
└─────────────────┘               │  scope=restlets │  claudeCodeAPI_RL │   (see incident)
                                   └────────────────▶└───────────────────┘
```

`executeSuiteQL` / `getRecord` use the native REST path (top, working). `runSearch` /
`lookupFields` / `createRecord` / `updateRecord` use the legacy RESTlet path (bottom, broken as
of 2026-07-08). Both paths share the same JWT-signing and token-caching code, just requesting a
different OAuth scope.

**Components:**
- **netsuite-client.js** - Node.js client with OAuth 2.0 M2M authentication, both paths above
- **claudeCodeAPI_RL.js** - RESTlet deployed in NetSuite (handles SuiteQL, record ops, searches, writes) - legacy path only, currently broken
- **private.pem / public.pem** - RSA 3072-bit key pair for JWT signing

## Authentication

This client uses **OAuth 2.0 Client Credentials (M2M)** flow:

1. Creates a JWT signed with RSA-PSS (PS256 algorithm)
2. Exchanges JWT for access token at NetSuite token endpoint
3. Uses access token as Bearer token for API requests
4. Tokens are cached and automatically refreshed

### Current Configuration

| Setting | Value |
|---------|-------|
| Account ID | `6511399` |
| Native REST API host | `6511399.suitetalk.api.netsuite.com` (SuiteQL + Record API - working) |
| Legacy RESTlet Script ID | `customscript_hyc_claude_code_api_rl` (currently BROKEN - see "Restore checklist" above) |
| Legacy RESTlet Deploy ID | `customdeploy_hyc_claude_code_api_r` (currently BROKEN - see "Restore checklist" above) |
| Token Endpoint | `https://6511399.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |

Note: this table previously listed numeric ids `2111` / `1` for the RESTlet - those were stale/
incorrect (confirmed 2026-07-08, see incident section above) and have been replaced with the
actual scriptid/deployid strings `netsuite-client.js` uses.

**Security Note:** Client credentials are stored in `netsuite-client.js` / `private.pem` in this
folder. Never paste the actual Client ID, Certificate ID, or key contents into a skill, ticket,
task note, or anything else that gets committed or logged - reference this file's path instead.
In production, consider using environment variables.

## Setup Instructions (If Recreating)

### 1. Generate RSA Key Pair

NetSuite requires RSA keys (minimum 3072 bits) with PS256 signing:

```bash
# Generate private key
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out private.pem

# Generate self-signed certificate (valid 2 years)
openssl req -new -x509 -key private.pem -out public.pem -days 730 \
  -subj "/CN=Claude Code API/O=Water Creation"
```

### 2. Create Integration Record in NetSuite

1. Go to **Setup > Integration > Manage Integrations > New**
2. Name: `Claude Code API`
3. Enable:
   - TOKEN-BASED AUTHENTICATION
   - CLIENT CREDENTIALS (MACHINE TO MACHINE) GRANT
4. Scope: Check **RESTLETS** and **REST WEB SERVICES**
5. Save and **copy the Client ID** (shown only once!)

### 3. Create M2M Certificate Mapping

1. Go to **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup**
2. Click **Create New**
3. Select:
   - Entity: Your user
   - Role: Administrator
   - Application: Claude Code API
4. Upload `public.pem` certificate
5. Save and **copy the Certificate ID**

### 4. Update Configuration

Edit `netsuite-client.js` and update:
- `clientId` - The Client ID from step 2 (NOT the Application ID!)
- `certificateId` - The Certificate ID from step 3

## RESTlet API Reference

The RESTlet (`claudeCodeAPI_RL.js`) supports these actions via POST:

### SuiteQL Query
```json
{
  "action": "suiteql",
  "query": "SELECT id, companyname FROM customer FETCH FIRST 10 ROWS ONLY",
  "maxRows": 1000
}
```

### Get Record
```json
{
  "action": "getRecord",
  "recordType": "salesorder",
  "recordId": "12345"
}
```

### Lookup Fields
```json
{
  "action": "lookupFields",
  "recordType": "customer",
  "recordId": "330",
  "columns": ["companyname", "email", "phone"]
}
```

### Run Saved Search
```json
{
  "action": "search",
  "searchId": "customsearch_my_search",
  "maxRows": 500
}
```

### Ad-hoc Search
```json
{
  "action": "search",
  "type": "customer",
  "filters": [["isinactive", "is", "F"]],
  "columns": ["entityid", "companyname", "email"]
}
```

## Troubleshooting

### "server_error" (500)
- **Most common cause:** Using Application ID instead of Client ID
- The Client ID is shown only once when creating the Integration
- To get a new Client ID: Edit Integration > Reset Credentials

### "Invalid Login" Error
- Verify Client ID and Certificate ID are correct
- Check the M2M mapping is active (not revoked)
- Ensure Integration record is Enabled

### "Insufficient Permissions" Error
- Verify the role in M2M mapping has appropriate permissions
- Check RESTlet deployment audience includes the role

### Token Errors
- Ensure RSA key is at least 3072 bits
- Verify certificate hasn't expired
- Check RESTLETS scope is enabled on Integration

## Files

| File | Purpose |
|------|---------|
| `netsuite-client.js` | Main client with OAuth 2.0 and CLI |
| `private.pem` | RSA private key for JWT signing |
| `public.pem` | RSA certificate uploaded to NetSuite |
| `package.json` | Dependencies (oauth-1.0a not used for M2M) |

## Related Resources

- RESTlet Script: `src/FileCabinet/SuiteScripts/Hycentra/Integrations/API/claudeCodeAPI_RL.js`
- NetSuite OAuth 2.0 Docs: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162686838198.html
