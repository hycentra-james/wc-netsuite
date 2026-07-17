/**
 * NetSuite OAuth 2.0 Client Credentials (M2M) API Client for Claude Code
 *
 * 2026-07-08 FIX (live-data retrieval was broken):
 * The original client only ever requested an OAuth token with scope
 * "restlets" and sent every request through the custom RESTlet
 * (claudeCodeAPI_RL.js, script=customscript_hyc_claude_code_api_rl /
 * deploy=customdeploy_hyc_claude_code_api_r). That RESTlet deployment no
 * longer resolves in production - every call returns:
 *   { "error": { "code": "SSS_INVALID_SCRIPTLET_ID", "message": "That
 *     Suitelet is invalid, disabled, or no longer exists." } }
 * This was confirmed with BOTH the scriptid/deployid strings above AND the
 * numeric ids documented in README.md (2111 / 1) - neither resolves, so the
 * deployment record itself is missing/deleted/disabled in NetSuite, not a
 * typo in this file. The OAuth/JWT/M2M setup itself is fine (confirmed:
 * token exchange succeeds every time, for both scopes below).
 *
 * FIX: bypass the broken custom RESTlet entirely and call NetSuite's native
 * REST Record API / SuiteQL endpoints directly, using an OAuth token with
 * scope "rest_webservices" instead of "restlets". These are standard
 * NetSuite platform endpoints (not a custom script), so there is no
 * deployment record to break:
 *   - SuiteQL:      POST /services/rest/query/v1/suiteql
 *   - Record read:  GET  /services/rest/record/v1/{recordType}/{id}
 * Both were verified working against production account 6511399 (2026-07-08).
 *
 * Known gap: the native REST Record API does NOT expose on-hand/available
 * inventory quantity (no "quantityavailable" field on inventoryitem, and
 * the SuiteQL `inventorybalance` table only has rows for items that
 * currently carry a bin/lot balance) and does not support executing an
 * existing saved search by internal ID (`search.load({id})` equivalent).
 * Both of those DO still require the custom RESTlet (search.lookupFields /
 * search.load give the "item" search type's computed
 * locationquantityavailable column). If you need those, the RESTlet
 * deployment needs to be found or recreated in NetSuite - see README.md
 * "Live-data retrieval - 2026-07-08 incident" section for what to check /
 * what to hand James.
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
    accountId: '6511399',
    clientId: '9199cae528a9759f4e8fcd33dde07f79257436116c08b3502cf3df3eecb1b532',
    certificateId: 'l0zS7h1RPMBngCqoaP0gGvxWWWKdV9MJUAZEsqiv9s0',
    // Legacy custom RESTlet path - BROKEN as of 2026-07-08, kept only so it
    // can be retried once the deployment is fixed/recreated in NetSuite.
    scriptId: 'customscript_hyc_claude_code_api_rl',
    deployId: 'customdeploy_hyc_claude_code_api_r',
    // Paths to key files (relative to this script)
    privateKeyPath: path.join(__dirname, 'private.pem'),
    // Token endpoint
    tokenEndpoint: 'https://6511399.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token',
    // Native REST API host (SuiteQL + Record API)
    restApiHost: '6511399.suitetalk.api.netsuite.com'
};

// Token cache (separate per scope, since restlets vs rest_webservices are
// different grants)
const tokenCache = {};

// =============================================================================
// JWT Creation and Signing (RSA-PSS with SHA-256)
// =============================================================================

function base64UrlEncode(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function createJWT(scope) {
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    // NetSuite requires PS256 (RSA-PSS with SHA-256)
    const header = {
        alg: 'PS256',
        typ: 'JWT',
        kid: CONFIG.certificateId
    };

    const payload = {
        iss: CONFIG.clientId,
        scope,
        aud: CONFIG.tokenEndpoint,
        iat: now,
        exp: expiry
    };

    const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    // Read private key and sign with RSA-PSS
    const privateKey = fs.readFileSync(CONFIG.privateKeyPath, 'utf8');

    // Use RSA-PSS padding (PS256)
    const signature = crypto.sign('sha256', Buffer.from(signingInput), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    });

    const signatureB64 = base64UrlEncode(signature);

    return `${signingInput}.${signatureB64}`;
}

// =============================================================================
// OAuth 2.0 Token Management
// =============================================================================

async function getAccessToken(scope = 'rest_webservices') {
    const cached = tokenCache[scope];
    // Return cached token if still valid (with 5 minute buffer)
    if (cached && cached.expiry && Date.now() < cached.expiry - 300000) {
        return cached.token;
    }

    const jwt = createJWT(scope);

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: jwt
    }).toString();

    const urlObj = new URL(CONFIG.tokenEndpoint);

    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    if (response.access_token) {
                        const expiresIn = response.expires_in || 3600;
                        tokenCache[scope] = {
                            token: response.access_token,
                            expiry: Date.now() + (expiresIn * 1000)
                        };
                        resolve(response.access_token);
                    } else {
                        reject(new Error(`Token error: ${JSON.stringify(response)}`));
                    }
                } catch (e) {
                    reject(new Error(`Token parse error: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// =============================================================================
// Native REST API client (SuiteQL + Record API) - WORKING PATH
// =============================================================================

function httpsJson(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function executeSuiteQL(query, maxRows = 1000) {
    const token = await getAccessToken('rest_webservices');
    const body = JSON.stringify({ q: query });
    return httpsJson({
        hostname: CONFIG.restApiHost,
        path: `/services/rest/query/v1/suiteql?limit=${maxRows}`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Prefer': 'transient',
            'Content-Length': Buffer.byteLength(body)
        }
    }, body);
}

async function getRecord(recordType, recordId, expandSubResources = true) {
    const token = await getAccessToken('rest_webservices');
    const qs = expandSubResources ? '?expandSubResources=true' : '';
    return httpsJson({
        hostname: CONFIG.restApiHost,
        path: `/services/rest/record/v1/${recordType}/${recordId}${qs}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

// =============================================================================
// Legacy custom RESTlet path - BROKEN as of 2026-07-08 (SSS_INVALID_SCRIPTLET_ID)
// Kept so it can be retried once the deployment is found/fixed in NetSuite.
// Needed for: search.lookupFields/search.load (locationquantityavailable,
// saved-search-by-id), createRecord/updateRecord/submitFields (writes).
// =============================================================================

async function makeRestletRequest(method, body = null) {
    const accessToken = await getAccessToken('restlets');

    const baseUrl = `https://${CONFIG.accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`;
    const fullUrl = `${baseUrl}?script=${CONFIG.scriptId}&deploy=${CONFIG.deployId}`;

    const urlObj = new URL(fullUrl);

    const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    resolve({ raw: data, statusCode: res.statusCode });
                    return;
                }
                // Self-diagnosing hint: don't make the caller re-derive "the deployment is
                // broken" from a bare NetSuite error code every time. See README.md "Restore
                // checklist" for what to check in NetSuite (script id, deploy id, audience/role).
                if (parsed && parsed.error && parsed.error.code === 'SSS_INVALID_SCRIPTLET_ID') {
                    parsed._hint = 'Legacy RESTlet deployment (script=' + CONFIG.scriptId +
                        ', deploy=' + CONFIG.deployId + ') does not resolve in NetSuite - this is ' +
                        'NOT an auth problem (token exchange already succeeded to get here). See ' +
                        'tools/netsuite-api/README.md "Restore checklist" section. Native REST ' +
                        '(ping/suiteql/getRecord) is unaffected and still works.';
                }
                resolve(parsed);
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function runSearch(params) {
    return makeRestletRequest('POST', { action: 'search', ...params });
}

async function lookupFields(recordType, recordId, fields) {
    return makeRestletRequest('POST', { action: 'lookupFields', recordType, recordId, columns: fields });
}

async function createRecord(recordType, values) {
    return makeRestletRequest('POST', { action: 'createRecord', recordType, values });
}

async function updateRecord(recordType, recordId, values) {
    return makeRestletRequest('POST', { action: 'updateRecord', recordType, recordId, values });
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
Usage: node netsuite-client.js <action> [params]

Actions (native REST API - working):
  ping                              Test connectivity
  suiteql "<query>"                 Execute SuiteQL query
  getRecord <type> <id>             Get a record (native REST Record API)

Actions (legacy custom RESTlet - BROKEN, see README):
  lookup <type> <id> <fields...>    search.lookupFields (locationquantityavailable etc)
  search <searchId>                 Run saved search by internal id
        `);
        return;
    }

    const action = args[0].toLowerCase();
    let result;

    try {
        switch (action) {
            case 'ping':
                result = await executeSuiteQL('SELECT 1 as test FROM dual');
                break;
            case 'suiteql':
            case 'sql':
            case 'query':
                result = await executeSuiteQL(args[1]);
                break;
            case 'getrecord':
            case 'get':
                result = await getRecord(args[1], args[2]);
                break;
            case 'lookup':
                result = await lookupFields(args[1], args[2], args.slice(3));
                break;
            case 'search':
                result = await runSearch({ searchId: args[1] });
                break;
            default:
                console.error(`Unknown action: ${action}`);
                process.exit(1);
        }
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

module.exports = {
    CONFIG,
    getAccessToken,
    executeSuiteQL,
    getRecord,
    runSearch,
    lookupFields,
    createRecord,
    updateRecord,
    makeRestletRequest
};

if (require.main === module) main();
