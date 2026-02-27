# NetSuite API Client for Claude Code

Node.js client for accessing NetSuite data via RESTlet with OAuth 2.0 M2M (Machine-to-Machine) authentication.

## Quick Start

```bash
cd tools/netsuite-api

# Test connectivity
node netsuite-client.js ping

# Run a SuiteQL query
node netsuite-client.js suiteql "SELECT id, companyname FROM customer FETCH FIRST 10 ROWS ONLY"
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `ping` | Test connectivity | `node netsuite-client.js ping` |
| `suiteql <query>` | Execute SuiteQL query | `node netsuite-client.js suiteql "SELECT id FROM customer"` |
| `getRecord <type> <id>` | Get full record | `node netsuite-client.js getRecord salesorder 12345` |
| `lookup <type> <id> <fields...>` | Lookup specific fields | `node netsuite-client.js lookup customer 330 companyname email` |
| `search <searchId>` | Run saved search | `node netsuite-client.js search customsearch_my_search` |

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

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Claude Code    │────▶│  netsuite-client │────▶│  NetSuite   │
│  (CLI/Skill)    │     │  (OAuth 2.0 M2M) │     │  RESTlet    │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

**Components:**
- **netsuite-client.js** - Node.js client with OAuth 2.0 M2M authentication
- **claudeCodeAPI_RL.js** - RESTlet deployed in NetSuite (handles SuiteQL, record ops, searches)
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
| RESTlet Script ID | `2111` |
| RESTlet Deploy ID | `1` |
| Token Endpoint | `https://6511399.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token` |

**Security Note:** Client credentials are stored in `netsuite-client.js`. In production, consider using environment variables.

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
