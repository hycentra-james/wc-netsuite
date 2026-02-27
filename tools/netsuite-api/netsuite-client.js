/**
 * NetSuite OAuth 2.0 Client Credentials (M2M) API Client for Claude Code
 * Uses JWT assertion signed with EC private key for authentication
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
    scriptId: '2111',
    deployId: '1',
    // Paths to key files (relative to this script)
    privateKeyPath: path.join(__dirname, 'private.pem'),
    // Token endpoint
    tokenEndpoint: 'https://6511399.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token'
};

// Token cache
let cachedToken = null;
let tokenExpiry = null;

// =============================================================================
// JWT Creation and Signing (RSA-PSS with SHA-256)
// =============================================================================

function base64UrlEncode(buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function createJWT() {
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
        scope: 'restlets',
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

async function getAccessToken() {
    // Return cached token if still valid (with 5 minute buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
        return cachedToken;
    }

    const jwt = createJWT();

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
                        cachedToken = response.access_token;
                        // Set expiry (default 1 hour, or use expires_in from response)
                        const expiresIn = response.expires_in || 3600;
                        tokenExpiry = Date.now() + (expiresIn * 1000);
                        resolve(cachedToken);
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
// API Client
// =============================================================================

async function makeRequest(method, body = null) {
    const accessToken = await getAccessToken();

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
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data, statusCode: res.statusCode });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function executeSuiteQL(query, maxRows = 1000) {
    return makeRequest('POST', { action: 'suiteql', query, maxRows });
}

async function getRecord(recordType, recordId) {
    return makeRequest('POST', { action: 'getRecord', recordType, recordId });
}

async function runSearch(params) {
    return makeRequest('POST', { action: 'search', ...params });
}

async function lookupFields(recordType, recordId, fields) {
    return makeRequest('POST', { action: 'lookupFields', recordType, recordId, columns: fields });
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
Usage: node netsuite-client.js <action> [params]

Actions:
  ping                              Test connectivity
  suiteql "<query>"                 Execute SuiteQL query
  getRecord <type> <id>             Get a record
  lookup <type> <id> <fields...>    Lookup fields
  search <searchId>                 Run saved search
        `);
        return;
    }

    const action = args[0].toLowerCase();
    let result;

    try {
        switch (action) {
            case 'ping':
                result = await executeSuiteQL('SELECT 1 as test');
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

module.exports = { CONFIG, executeSuiteQL, getRecord, runSearch, lookupFields, makeRequest };

if (require.main === module) main();
