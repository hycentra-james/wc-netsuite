/*
 * upsHelper.js
 * UPS API helper functions - OAuth, API communication, utilities
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/runtime', 'N/record', 'N/format', 'N/https', 'N/error', 'N/log', 'N/file', 'N/search', 'N/encode', 'N/url', '../../../Concentrus/PackShipTemplate/Con_Lib_Print_Node.js'],
    function (runtime, record, format, https, error, log, file, search, encode, url, printNodeLib) {
        const CONFIG_RECORD_TYPE = 'customrecord_hyc_ups_config';
        const SANDBOX_CONFIG_RECORD_ID = 1; // UPS Sandbox config record ID
        const PRODUCTION_CONFIG_RECORD_ID = 2; // UPS Production config record ID
        const WC_UPS_MAPPING_RECORD_ID = 11; // HYC Shipping Label Mapping List (Default Account)
        const WC_PHONE_NUMBER = '9097731777';

        // Pottery Barn return label configuration
        const POTTERY_BARN_CUSTOMER_ID = 1419;
        const PB_RETURN_ADDRESS = {
            Name: 'Williams Sonoma',
            AttentionName: 'PH1DTC',
            Address: {
                AddressLine: ['7755 Polk Lane'],
                City: 'Olive Branch',
                StateProvinceCode: 'MS',
                PostalCode: '38654-7532',
                CountryCode: 'US'
            }
        };

        // Module-level variable to store test mode flag
        // Auto-detect based on NetSuite environment (sandbox vs production)
        var IS_TEST_MODE = (runtime.envType === runtime.EnvType.SANDBOX);

        /**
         * Set test mode flag (overrides auto-detected environment)
         *
         * @param {boolean} testMode Whether to use sandbox configuration
         */
        function setTestMode(testMode) {
            IS_TEST_MODE = testMode;
            log.debug('UPS Test Mode', 'Test mode manually set to: ' + IS_TEST_MODE);
        }

        /**
         * Get current test mode flag
         *
         * @returns {boolean} Current test mode value
         */
        function getTestMode() {
            return IS_TEST_MODE;
        }

        /**
         * Get the current config record ID based on test mode
         *
         * @returns {number} Config record ID
         */
        function getCurrentConfigRecordId() {
            return IS_TEST_MODE ? SANDBOX_CONFIG_RECORD_ID : PRODUCTION_CONFIG_RECORD_ID;
        }

        /**
         * Get the UPS API URL endpoint from the custom preferences
         *
         * @returns {string} The URL string
         */
        function getApiUrl() {
            // Define URLs at the top for clarity
            var SANDBOX_URL = 'https://wwwcie.ups.com/';
            var PRODUCTION_URL = 'https://onlinetools.ups.com/';

            try {
                var configRecordId = getCurrentConfigRecordId();
                log.debug('DEBUG', 'getApiUrl()::IS_TEST_MODE = ' + IS_TEST_MODE + ', using config record ID = ' + configRecordId);

                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId
                });

                if (!tokenRecord.isEmpty) {
                    var endpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_endpoint' });

                    // If no endpoint configured, use appropriate default based on test mode
                    if (!endpoint) {
                        endpoint = IS_TEST_MODE ? SANDBOX_URL : PRODUCTION_URL;
                        log.debug('DEBUG', 'No endpoint configured, using default: ' + endpoint);
                    }

                    // Ensure endpoint ends with trailing slash
                    if (endpoint && !endpoint.endsWith('/')) {
                        endpoint = endpoint + '/';
                        log.debug('DEBUG', 'Added trailing slash to endpoint: ' + endpoint);
                    }

                    log.debug('DEBUG', 'getApiUrl()::returning endpoint = ' + endpoint);
                    return endpoint;
                } else {
                    var defaultUrl = IS_TEST_MODE ? SANDBOX_URL : PRODUCTION_URL;
                    log.debug('DEBUG', 'Empty token record, using default: ' + defaultUrl);
                    return defaultUrl;
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error getting API URL, using default: ' + e.message
                });
                // Fallback based on test mode
                return IS_TEST_MODE ? SANDBOX_URL : PRODUCTION_URL;
            }
        }

        /**
         * Get the UPS API configuration record
         *
         * @returns {record} The UPS configuration token record
         */
        function getTokenRecord() {
            log.debug('DEBUG', 'getTokenRecord()::start');
            try {
                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: getCurrentConfigRecordId()
                });

                // Check if the token is still valid
                tokenRecord = validateToken(tokenRecord);

                return tokenRecord;
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error loading UPS configuration record: ' + e.message
                });
                throw e;
            }
        }

        /**
         * Validate if the current token is still valid or needs refresh
         *
         * @param {record} tokenRecord The UPS configuration record
         * @returns {record} Updated token record
         */
        function validateToken(tokenRecord) {
            try {
                var accessToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var expirationValue = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_expiration' });

                // If access_token is missing or empty, refresh the token
                if (!accessToken || accessToken === '') {
                    log.debug('DEBUG', 'No access token found, refreshing token');
                    tokenRecord = refreshToken(tokenRecord);
                    return tokenRecord;
                }

                // If expiration value is missing, refresh the token
                if (!expirationValue) {
                    log.debug('DEBUG', 'No expiration date found, refreshing token');
                    tokenRecord = refreshToken(tokenRecord);
                    return tokenRecord;
                }

                // Parse expiration date and check if token is still valid
                var expirationDateObj = format.parse({
                    value: expirationValue,
                    type: format.Type.DATETIMETZ
                });

                var nowDateObj = new Date();

                if (expirationDateObj > nowDateObj) {
                    log.debug('DEBUG', 'UPS token is still valid');
                } else {
                    log.debug('DEBUG', 'UPS token expired, renewing...');
                    tokenRecord = refreshToken(tokenRecord);
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error validating UPS token: ' + e.message
                });
                log.debug('DEBUG', 'Token validation failed, refreshing token');
                tokenRecord = refreshToken(tokenRecord);
            }

            return tokenRecord;
        }

        /**
         * Refresh the UPS OAuth token
         * UPS uses Basic Auth header with base64-encoded client_id:client_secret
         *
         * @param {record} tokenRecord The UPS configuration record
         * @returns {record} Updated token record
         */
        function refreshToken(tokenRecord) {
            var baseUrl = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_endpoint' }) || 'https://onlinetools.ups.com/';

            // Ensure endpoint ends with trailing slash
            if (!baseUrl.endsWith('/')) {
                baseUrl = baseUrl + '/';
            }

            var apiUrl = baseUrl + 'security/v1/oauth/token';
            var clientId = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_client_id' });
            var clientSecret = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_secret' });

            // UPS requires Basic Auth header with base64-encoded credentials
            var credentials = clientId + ':' + clientSecret;
            var encodedCredentials = encode.convert({
                string: credentials,
                inputEncoding: encode.Encoding.UTF_8,
                outputEncoding: encode.Encoding.BASE_64
            });

            var payload = 'grant_type=client_credentials';

            log.debug('DEBUG', 'refreshToken()::apiUrl = ' + apiUrl);

            try {
                var response = https.post({
                    url: apiUrl,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + encodedCredentials
                    },
                    body: payload
                });

                if (response.code === 200) {
                    var responseBody = JSON.parse(response.body);
                    var accessToken = responseBody.access_token;
                    var expiresIn = responseBody.expires_in; // UPS tokens expire in 14400 seconds (4 hours)

                    log.debug('DEBUG', 'refreshToken()::accessToken = ' + accessToken.substring(0, 20) + '...');
                    log.debug('DEBUG', 'refreshToken()::expiresIn = ' + expiresIn);

                    updateAccessToken(accessToken, expiresIn);
                    log.debug('DEBUG', 'refreshToken()::updateAccessToken success');

                    return getTokenRecord();
                } else {
                    log.error('DEBUG', 'UPS OAuth HTTP Status Code: ' + response.code);
                    log.error('DEBUG', 'UPS OAuth Error Message: ' + response.body);
                    throw error.create({
                        name: 'UPS_AUTH_FAILED',
                        message: 'Failed to refresh UPS OAuth token. Status: ' + response.code + ', Message: ' + response.body
                    });
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error refreshing UPS token: ' + e.message
                });
                throw e;
            }

            return tokenRecord;
        }

        /**
         * Update the access token in the configuration record
         *
         * @param {string} newAccessToken The new access token
         * @param {number} expiresIn Expiration time in seconds
         */
        function updateAccessToken(newAccessToken, expiresIn) {
            log.debug('DEBUG', 'updateAccessToken()::newAccessToken = ' + newAccessToken.substring(0, 20) + '...');
            log.debug('DEBUG', 'updateAccessToken()::expiresIn = ' + expiresIn);

            // Calculate expiration timestamp (subtract 5 minutes for buffer)
            var bufferSeconds = 300;
            var expirationTimestamp = new Date().getTime() + ((expiresIn - bufferSeconds) * 1000);

            log.debug('DEBUG', 'updateAccessToken()::expirationTimestamp = ' + expirationTimestamp);

            record.submitFields({
                type: CONFIG_RECORD_TYPE,
                id: getCurrentConfigRecordId(),
                values: {
                    'custrecord_hyc_ups_access_token': newAccessToken,
                    'custrecord_hyc_ups_expiration': new Date(expirationTimestamp)
                }
            });

            log.debug('DEBUG', 'updateAccessToken() success');
        }

        /**
         * POST call to the UPS API
         *
         * @param {string} token Bearer token for authentication
         * @param {string} apiUrl The URL at which to make the POST request
         * @param {string} json The JSON string to post
         * @returns {Object} The API response, containing status and result
         */
        function postToApi(token, apiUrl, json) {
            var retries = 3;
            var success = false;
            var response;

            while (retries > 0 && success === false) {
                try {
                    response = https.post({
                        url: apiUrl,
                        body: json,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    });
                    success = true;
                } catch (e) {
                    retries--;
                    log.error('ERROR', 'UPS API POST attempt failed: ' + e.message);
                    if (retries === 0) {
                        throw e;
                    }
                    // Wait 1 second before retry
                    var start = new Date().getTime();
                    while (new Date().getTime() < start + 1000) {
                        // Wait
                    }
                }
            }

            log.debug('DEBUG', 'UPS API success = ' + success);
            log.debug('DEBUG', 'UPS API response.code = ' + response.code);
            log.debug('DEBUG', 'UPS API response.body = ' + response.body);

            var result = response.body;

            try {
                result = JSON.parse(result);
            } catch (e) {
                log.debug('DEBUG', 'UPS API response.body is not JSON formatted string');
            }

            var ret = {
                status: response.code,
                result: result
            };

            if (!ret.result || ret.status >= 400) {
                throw error.create({
                    name: 'UPS_API_POST_FAILED',
                    message: 'Error posting data to UPS API endpoint ' + apiUrl + '. API responded with status ' + ret.status +
                        '. API response: ' + JSON.stringify(ret.result)
                });
            }

            return ret;
        }

        /**
         * GET call to the UPS API
         *
         * @param {string} token Bearer token for authentication
         * @param {string} apiUrl The URL at which to make the GET request
         * @returns {Object} The API response, containing status and result
         */
        function getFromApi(token, apiUrl) {
            var retries = 3;
            var success = false;
            var response;

            while (retries > 0 && success === false) {
                try {
                    response = https.get({
                        url: apiUrl,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            'Accept': 'application/json'
                        }
                    });
                    success = true;
                } catch (e) {
                    retries--;
                    log.error('ERROR', 'UPS API GET attempt failed: ' + e.message);
                    if (retries === 0) {
                        throw e;
                    }
                    var start = new Date().getTime();
                    while (new Date().getTime() < start + 1000) {
                        // Wait
                    }
                }
            }

            var result = response.body;

            try {
                result = JSON.parse(result);
            } catch (e) {
                log.debug('DEBUG', 'UPS API response.body is not JSON formatted string');
            }

            return {
                status: response.code,
                result: result
            };
        }

        /**
         * Get shipping label mapping record for the fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object|null} Mapping record or null if not found
         */
        function getShippingLabelMapping(fulfillmentRecord) {
            try {
                var customerId = fulfillmentRecord.getValue({ fieldId: 'entity' });
                var shipMethodId = fulfillmentRecord.getValue({ fieldId: 'shipmethod' });

                log.debug('DEBUG', 'getShippingLabelMapping()::customerId = ' + customerId);
                log.debug('DEBUG', 'getShippingLabelMapping()::shipMethodId = ' + shipMethodId);

                if (customerId && shipMethodId) {
                    var mappingSearch = search.create({
                        type: 'customrecord_hyc_shipping_label_mapping',
                        filters: [
                            ['custrecord_hyc_ship_lbl_map_customer', search.Operator.ANYOF, customerId],
                            'AND',
                            ['custrecord_hyc_ship_lbl_map_ship_method', search.Operator.ANYOF, shipMethodId]
                        ],
                        columns: [
                            'internalid',
                            'custrecord_hyc_ship_lbl_ship_from',
                            'custrecord_hyc_ship_lbl_account_no',
                            'custrecord_hyc_ship_lbl_customer_ref_1',
                            'custrecord_hyc_ship_lbl_customer_ref_2',
                            'custrecord_hyc_ship_lbl_customer_ref_3',
                            'custrecord_hyc_ship_lbl_3p_bill_addr'
                        ]
                    });

                    var searchResults = mappingSearch.run().getRange({ start: 0, end: 1 });

                    if (searchResults && searchResults.length > 0) {
                        var result = searchResults[0];
                        var mappingId = parseInt(result.getValue('internalid'), 10);
                        log.debug('DEBUG', 'getShippingLabelMapping()::Found mapping record ID: ' + mappingId);

                        // Return wrapper with id property for third-party billing detection
                        return {
                            id: mappingId,
                            getValue: function (fieldId) {
                                return result.getValue(fieldId);
                            }
                        };
                    } else {
                        log.debug('DEBUG', 'getShippingLabelMapping()::No matching mapping record found, using fallback record ID ' + WC_UPS_MAPPING_RECORD_ID);
                    }
                } else {
                    log.debug('DEBUG', 'getShippingLabelMapping()::Missing customerId or shipMethodId, using fallback record ID ' + WC_UPS_MAPPING_RECORD_ID);
                }

                // Fallback to record ID WC_UPS_MAPPING_RECORD_ID (default WC account)
                var fallbackRecord = record.load({
                    type: 'customrecord_hyc_shipping_label_mapping',
                    id: WC_UPS_MAPPING_RECORD_ID
                });

                return {
                    id: WC_UPS_MAPPING_RECORD_ID,
                    getValue: function (fieldId) {
                        return fallbackRecord.getValue({ fieldId: fieldId });
                    }
                };

            } catch (e) {
                log.error('ERROR', 'Failed to get shipping label mapping: ' + e.message);
                return null;
            }
        }

        /**
         * Validate and format phone number to ensure it's a valid 10-digit US phone number
         *
         * @param {string} phoneNumber The phone number to validate
         * @returns {string} Valid 10-digit phone number or '9999999999' as fallback
         */
        function validatePhoneNumber(phoneNumber) {
            try {
                if (!phoneNumber) {
                    log.debug('Phone Validation', 'Empty phone number, using fallback');
                    return '9999999999';
                }

                var cleanedPhone = phoneNumber.toString().replace(/\D/g, '');
                log.debug('Phone Validation', 'Original: "' + phoneNumber + '", Cleaned: "' + cleanedPhone + '"');

                if (cleanedPhone.length === 10) {
                    log.debug('Phone Validation', 'Valid 10-digit number: ' + cleanedPhone);
                    return cleanedPhone;
                }

                if (cleanedPhone.length === 11 && cleanedPhone.charAt(0) === '1') {
                    var phoneWithoutCountryCode = cleanedPhone.substring(1);
                    log.debug('Phone Validation', 'Removed country code 1: ' + phoneWithoutCountryCode);
                    return phoneWithoutCountryCode;
                }

                log.debug('Phone Validation', 'Invalid format (length: ' + cleanedPhone.length + '), using fallback');
                return '9999999999';

            } catch (e) {
                log.error('Phone Validation Error', 'Error validating phone: ' + e.message);
                return '9999999999';
            }
        }

        /**
         * Check if the fulfillment is for a Pottery Barn order
         * Pottery Barn orders require a return label to be created alongside the outbound label
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {boolean} True if this is a Pottery Barn order
         */
        function isPotteryBarnOrder(fulfillmentRecord) {
            try {
                var customerId = fulfillmentRecord.getValue({ fieldId: 'entity' });
                log.debug('isPotteryBarnOrder', 'Customer ID: ' + customerId + ', Pottery Barn ID: ' + POTTERY_BARN_CUSTOMER_ID);

                if (customerId == POTTERY_BARN_CUSTOMER_ID) {
                    log.debug('isPotteryBarnOrder', 'This is a Pottery Barn order');
                    return true;
                }

                // Also check parent customer (in case of sub-customer)
                try {
                    var customerRecord = record.load({
                        type: record.Type.CUSTOMER,
                        id: customerId
                    });
                    var parentCustomerId = customerRecord.getValue({ fieldId: 'parent' });
                    if (parentCustomerId == POTTERY_BARN_CUSTOMER_ID) {
                        log.debug('isPotteryBarnOrder', 'Parent customer is Pottery Barn');
                        return true;
                    }
                } catch (customerError) {
                    log.debug('isPotteryBarnOrder', 'Could not load customer record: ' + customerError.message);
                }

                return false;
            } catch (e) {
                log.error('isPotteryBarnOrder Error', 'Error checking Pottery Barn order: ' + e.message);
                return false;
            }
        }

        /**
         * Extract sequence number from carton name (e.g., "SO206966-1" -> "1")
         *
         * @param {string} cartonName The carton name (e.g., "SO206966-1")
         * @returns {number|null} Sequence number or null if not found
         */
        function extractCartonSequenceNumber(cartonName) {
            try {
                if (!cartonName) {
                    return null;
                }

                var match = cartonName.toString().match(/-(\d+)$/);
                if (match && match[1]) {
                    var sequenceNumber = parseInt(match[1], 10);
                    log.debug('Carton Sequence Extract', 'Carton "' + cartonName + '" -> Sequence: ' + sequenceNumber);
                    return sequenceNumber;
                }

                log.debug('Carton Sequence Extract', 'Could not extract sequence from carton name: "' + cartonName + '"');
                return null;
            } catch (e) {
                log.error('Carton Sequence Extract Error', 'Error extracting sequence from "' + cartonName + '": ' + e.message);
                return null;
            }
        }

        /**
         * Get current date in YYYY-MM-DD format
         *
         * @returns {string} Current date string
         */
        function getCurrentDateString() {
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            var year = tomorrow.getFullYear();
            var month = String(tomorrow.getMonth() + 1).padStart(2, '0');
            var day = String(tomorrow.getDate()).padStart(2, '0');
            return year + '-' + month + '-' + day;
        }

        /**
         * Get current date in YYYYMMDD format for filename
         *
         * @returns {string} Current date string for filename
         */
        function getCurrentDateForFilename() {
            var today = new Date();
            var year = today.getFullYear();
            var month = String(today.getMonth() + 1).padStart(2, '0');
            var day = String(today.getDate()).padStart(2, '0');
            return year + month + day;
        }

        /**
         * Get UPS service code from shipping method ID
         *
         * @param {string|number} shipMethodId The shipping method internal ID
         * @returns {string} UPS service code (e.g., '03' for Ground)
         */
        function getUPSServiceCode(shipMethodId) {
            var mapping = getShipMethodMappingById(shipMethodId);
            log.debug('UPS Service Code', 'Service code for ship method ' + shipMethodId + ': ' + mapping.serviceCode);
            return mapping.serviceCode;
        }

        /**
         * Get ship method mapping by ID
         *
         * @param {string|number} shipMethodId The shipping method internal ID
         * @returns {Object} Object with serviceCode and packagingType
         */
        function getShipMethodMappingById(shipMethodId) {
            // Default values for UPS
            var mapping = {
                serviceCode: '03', // UPS Ground
                packagingType: '02' // Customer Supplied Package
            };

            if (!shipMethodId) {
                log.debug('Ship Method Mapping', 'No ship method ID provided, using defaults');
                return mapping;
            }

            try {
                var shipMethodCodeSearch = search.create({
                    type: 'customrecord_hyc_shipmethod_code_map',
                    filters: [
                        ['custrecord_hyc_shipmethod_map_shipmethod', search.Operator.ANYOF, shipMethodId]
                    ],
                    columns: [
                        'custrecord_hyc_shipmethod_map_code',
                        'custrecord_hyc_shipmethod_pkg_type'
                    ]
                });

                var searchResults = shipMethodCodeSearch.run().getRange({ start: 0, end: 1 });

                if (searchResults && searchResults.length > 0) {
                    var result = searchResults[0];
                    var shipCode = result.getValue('custrecord_hyc_shipmethod_map_code') || '';
                    var packagingType = result.getValue('custrecord_hyc_shipmethod_pkg_type') || '';

                    if (shipCode) {
                        mapping.serviceCode = shipCode;
                        log.debug('Ship Method Mapping', 'Found service code from mapping: ' + shipCode);
                    }

                    if (packagingType) {
                        mapping.packagingType = packagingType;
                        log.debug('Ship Method Mapping', 'Found packaging type from mapping: ' + packagingType);
                    }
                } else {
                    log.debug('Ship Method Mapping', 'No mapping found for ship method ID: ' + shipMethodId + ', using defaults');
                }
            } catch (e) {
                log.error({
                    title: 'Ship Method Mapping Error',
                    details: 'Failed to lookup ship method mapping: ' + e.message + ', using defaults'
                });
            }

            return mapping;
        }

        /**
         * Get ship method mapping from fulfillment record
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} Object with serviceCode and packagingType
         */
        function getShipMethodMapping(fulfillmentRecord) {
            var shipMethodId = fulfillmentRecord.getValue({ fieldId: 'shipmethod' }) || 0;
            var shipMethodText = fulfillmentRecord.getText({ fieldId: 'shipmethod' }) || '';

            log.debug('Ship Method Mapping', 'shipMethod ID = ' + shipMethodId + ', Text = ' + shipMethodText);

            return getShipMethodMappingById(shipMethodId);
        }

        /**
         * Build shipper information from Shipping Label Mapping
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record (optional)
         * @param {Object} mappingRecord The shipping label mapping record
         * @returns {Object} Shipper information in UPS format
         */
        function buildShipperInfo(fulfillmentRecord, mappingRecord) {
            try {
                if (mappingRecord) {
                    var shipFromJson = mappingRecord.getValue('custrecord_hyc_ship_lbl_ship_from');
                    log.debug('DEBUG', 'buildShipperInfo()::shipFromJson = ' + shipFromJson);

                    if (shipFromJson) {
                        var shipperData = JSON.parse(shipFromJson);
                        log.debug('DEBUG', 'buildShipperInfo()::Using custom shipper info from mapping');

                        // Convert to UPS format
                        return {
                            Name: shipperData.contact ? shipperData.contact.companyName || 'Water Creation' : 'Water Creation',
                            AttentionName: shipperData.contact ? shipperData.contact.personName || 'Shipping Department' : 'Shipping Department',
                            Phone: {
                                Number: shipperData.contact ? shipperData.contact.phoneNumber || WC_PHONE_NUMBER : WC_PHONE_NUMBER
                            },
                            ShipperNumber: getTokenRecord().getValue({ fieldId: 'custrecord_hyc_ups_account_number' }),
                            Address: {
                                AddressLine: shipperData.address ? shipperData.address.streetLines || ['701 Auto Center Dr'] : ['701 Auto Center Dr'],
                                City: shipperData.address ? shipperData.address.city || 'Ontario' : 'Ontario',
                                StateProvinceCode: shipperData.address ? shipperData.address.stateOrProvinceCode || 'CA' : 'CA',
                                PostalCode: shipperData.address ? shipperData.address.postalCode || '91761' : '91761',
                                CountryCode: shipperData.address ? shipperData.address.countryCode || 'US' : 'US'
                            }
                        };
                    }
                }

            } catch (e) {
                log.error('ERROR', 'Failed to get shipper info from mapping: ' + e.message);
            }

            // Final fallback to hardcoded values
            log.debug('DEBUG', 'buildShipperInfo()::Using hardcoded fallback shipper info');
            var companyInfo = runtime.getCurrentUser().getPreference({ name: 'COMPANYNAME' }) || 'Water Creation';

            return {
                Name: companyInfo,
                AttentionName: 'Shipping Department',
                Phone: {
                    Number: WC_PHONE_NUMBER
                },
                ShipperNumber: getTokenRecord().getValue({ fieldId: 'custrecord_hyc_ups_account_number' }),
                Address: {
                    AddressLine: ['701 Auto Center Dr'],
                    City: 'Ontario',
                    StateProvinceCode: 'CA',
                    PostalCode: '91761',
                    CountryCode: 'US'
                }
            };
        }

        /**
         * Build recipient information from Item Fulfillment shipping address
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} Recipient information in UPS format
         */
        function buildRecipientInfo(fulfillmentRecord) {
            log.debug('buildRecipientInfo', 'Building recipient information');

            try {
                // Try to access shippingaddress as a subrecord
                try {
                    var shippingAddressSubrecord = fulfillmentRecord.getSubrecord({ fieldId: 'shippingaddress' });
                    if (shippingAddressSubrecord) {
                        var addr1 = shippingAddressSubrecord.getValue({ fieldId: 'addr1' });
                        var addr2 = shippingAddressSubrecord.getValue({ fieldId: 'addr2' });
                        var city = shippingAddressSubrecord.getValue({ fieldId: 'city' });
                        var state = shippingAddressSubrecord.getValue({ fieldId: 'state' });
                        var zip = shippingAddressSubrecord.getValue({ fieldId: 'zip' });
                        var countryId = shippingAddressSubrecord.getValue({ fieldId: 'country' });

                        var countryCode = 'US';
                        if (countryId) {
                            try {
                                var countryRecord = record.load({ type: 'country', id: countryId });
                                countryCode = countryRecord.getValue({ fieldId: 'countrycode' }) || 'US';
                            } catch (countryError) {
                                log.debug('Country Lookup Warning', 'Could not load country ID: ' + countryId + ', using default US');
                            }
                        }

                        if (addr1 && city && state && zip) {
                            var addressLines = [addr1];
                            if (addr2) {
                                addressLines.push(addr2);
                            }

                            var isResidential = fulfillmentRecord.getValue({ fieldId: 'shipisresidential' });

                            log.debug('Shipping Address Success', 'Using shippingaddress subrecord');
                            return {
                                Name: shippingAddressSubrecord.getValue({ fieldId: 'attention' }) ||
                                    shippingAddressSubrecord.getValue({ fieldId: 'addressee' }) ||
                                    'Customer',
                                Phone: {
                                    Number: validatePhoneNumber(shippingAddressSubrecord.getValue({ fieldId: 'addrphone' }))
                                },
                                Address: {
                                    AddressLine: addressLines,
                                    City: city,
                                    StateProvinceCode: state,
                                    PostalCode: zip,
                                    CountryCode: countryCode,
                                    ResidentialAddressIndicator: isResidential ? 'Y' : ''
                                }
                            };
                        }
                    }
                } catch (subrecordError) {
                    log.debug('Shipping Address Subrecord Warning', 'Could not access shippingaddress as subrecord: ' + subrecordError.message);
                }

                // Try custbody_lb_sourced_data JSON
                try {
                    var lbSourcedData = fulfillmentRecord.getValue({ fieldId: 'custbody_lb_sourced_data' });
                    if (lbSourcedData) {
                        var lbData = JSON.parse(lbSourcedData);
                        var shipTo = null;

                        if (lbData.ShipTo) {
                            shipTo = lbData.ShipTo;
                        } else if (lbData.packSlipFields && lbData.packSlipFields.ShipTo) {
                            shipTo = lbData.packSlipFields.ShipTo;
                        }

                        if (shipTo && shipTo.Address1 && shipTo.City && shipTo.State && shipTo.Zip) {
                            var addressLines = [shipTo.Address1];
                            if (shipTo.Address2) {
                                addressLines.push(shipTo.Address2);
                            }

                            log.debug('LB Sourced Data Success', 'Using custbody_lb_sourced_data JSON');
                            return {
                                Name: shipTo.CompanyName || 'Customer',
                                Phone: {
                                    Number: validatePhoneNumber(shipTo.Phone)
                                },
                                Address: {
                                    AddressLine: addressLines,
                                    City: shipTo.City,
                                    StateProvinceCode: shipTo.State,
                                    PostalCode: shipTo.Zip,
                                    CountryCode: shipTo.Country || 'US',
                                    ResidentialAddressIndicator: fulfillmentRecord.getValue({ fieldId: 'shipisresidential' }) ? 'Y' : ''
                                }
                            };
                        }
                    }
                } catch (jsonError) {
                    log.debug('LB Sourced Data Warning', 'Could not parse custbody_lb_sourced_data: ' + jsonError.message);
                }

            } catch (e) {
                log.error('Error building recipient info', e.toString());
            }

            // Final fallback
            log.debug('Address Fallback', 'Using generic fallback address');
            return {
                Name: fulfillmentRecord.getText({ fieldId: 'entity' }) || 'Customer',
                Phone: {
                    Number: WC_PHONE_NUMBER
                },
                Address: {
                    AddressLine: ['Address Not Available'],
                    City: 'Unknown',
                    StateProvinceCode: 'XX',
                    PostalCode: '00000',
                    CountryCode: 'US'
                }
            };
        }

        /**
         * Save UPS label (base64-encoded) to file cabinet
         *
         * @param {string} base64Data The base64-encoded label data
         * @param {string} salesOrderNumber The sales order number for filename
         * @param {number} packageSequenceNumber The package sequence number
         * @param {string} labelFormat The label format (ZPL, GIF, PNG)
         * @param {boolean} [isReturnLabel=false] Whether this is a return label (adds RETURN_ prefix)
         * @returns {string} File URL if successful, null if failed
         */
        function saveUPSLabel(base64Data, salesOrderNumber, packageSequenceNumber, labelFormat, isReturnLabel) {
            try {
                log.debug('DEBUG', 'saveUPSLabel()::salesOrderNumber = ' + salesOrderNumber);
                log.debug('DEBUG', 'saveUPSLabel()::packageSequenceNumber = ' + packageSequenceNumber);
                log.debug('DEBUG', 'saveUPSLabel()::labelFormat = ' + labelFormat);
                log.debug('DEBUG', 'saveUPSLabel()::isReturnLabel = ' + isReturnLabel);

                var dateStr = getCurrentDateForFilename();
                var extension = labelFormat === 'ZPL' ? '.zpl' : (labelFormat === 'GIF' ? '.gif' : '.png');
                var suffix = isReturnLabel ? '_RETURN' : '';
                var fileName = dateStr + '_' + salesOrderNumber + '_' + packageSequenceNumber + suffix + extension;

                log.debug('DEBUG', 'saveUPSLabel()::fileName = ' + fileName);

                // Get or create UPS labels folder (return labels now use same folder with _RETURN suffix)
                var folderId = getUPSLabelFolderId();

                var labelFile;

                if (labelFormat === 'ZPL') {
                    // ZPL is text-based - decode base64 manually and save as plain text
                    var decodedZpl = encode.convert({
                        string: base64Data,
                        inputEncoding: encode.Encoding.BASE_64,
                        outputEncoding: encode.Encoding.UTF_8
                    });

                    log.debug('DEBUG', 'saveUPSLabel()::Decoded ZPL length = ' + decodedZpl.length);

                    labelFile = file.create({
                        name: fileName,
                        fileType: file.Type.PLAINTEXT,
                        isOnline: true,
                        contents: decodedZpl,
                        folder: folderId
                    });
                } else {
                    // GIF/PNG are binary - use base64 encoding
                    var fileType = labelFormat === 'GIF' ? file.Type.GIFIMAGE : file.Type.PNGIMAGE;

                    labelFile = file.create({
                        name: fileName,
                        fileType: fileType,
                        isOnline: true,
                        contents: base64Data,
                        encoding: file.Encoding.BASE_64,
                        folder: folderId
                    });
                }

                var fileId = labelFile.save();
                log.debug('DEBUG', 'saveUPSLabel()::Saved file ID = ' + fileId);

                // Get file URL
                var savedFile = file.load({ id: fileId });
                var fileUrl = savedFile.url;

                log.debug('DEBUG', 'saveUPSLabel()::fileUrl = ' + fileUrl);
                return fileUrl;

            } catch (e) {
                log.error('ERROR', 'Failed to save UPS label: ' + e.message);
                return null;
            }
        }

        /**
         * Get or create UPS labels folder in file cabinet
         *
         * @returns {number} Folder ID
         */
        function getUPSLabelFolderId() {
            try {
                // Search for existing folder
                var folderSearch = search.create({
                    type: search.Type.FOLDER,
                    filters: [
                        ['name', search.Operator.IS, 'UPS Labels']
                    ],
                    columns: ['internalid']
                });

                var searchResults = folderSearch.run().getRange({ start: 0, end: 1 });

                if (searchResults && searchResults.length > 0) {
                    return searchResults[0].getValue('internalid');
                }

                // Create folder if it doesn't exist
                var newFolder = record.create({
                    type: record.Type.FOLDER
                });
                newFolder.setValue({ fieldId: 'name', value: 'UPS Labels' });
                var folderId = newFolder.save();

                log.debug('DEBUG', 'Created UPS Labels folder with ID: ' + folderId);
                return folderId;

            } catch (e) {
                log.error('ERROR', 'Failed to get/create UPS Labels folder: ' + e.message);
                // Return a default folder ID (SuiteScripts folder = -15)
                return -15;
            }
        }

        /**
         * Print UPS labels using PrintNode
         *
         * @param {Array} labelUrls Array of label file URLs
         */
        function printUPSLabels(labelUrls) {
            try {
                if (!labelUrls || labelUrls.length === 0) {
                    log.debug('Print UPS Labels', 'No labels to print');
                    return;
                }

                // Skip printing in sandbox/test mode
                if (IS_TEST_MODE) {
                    log.debug('Print UPS Labels', 'Skipping print - Test mode enabled. ' + labelUrls.length + ' label(s) would be printed.');
                    return;
                }

                log.debug('Print UPS Labels', 'Printing ' + labelUrls.length + ' labels');

                // Get NetSuite domain for converting relative URLs to full URLs
                // PrintNode is an external service and needs full URLs to fetch label files
                var domain = url.resolveDomain({
                    hostType: url.HostType.APPLICATION,
                    accountId: runtime.accountId
                });

                for (var i = 0; i < labelUrls.length; i++) {
                    try {
                        // Convert relative URL to full URL if needed
                        var labelUrl = labelUrls[i];
                        var fullUrl = labelUrl.indexOf('http') === 0 ? labelUrl : 'https://' + domain + labelUrl;

                        log.debug('Print UPS Label', 'Printing label ' + (i + 1) + ': ' + fullUrl);

                        printNodeLib.printByPrintNode(
                            'UPS Label ' + (i + 1),
                            fullUrl,
                            printNodeLib.REPORT_TYPE.UPS_LABEL
                        );
                        log.debug('Print UPS Label', 'Printed label: ' + fullUrl);
                    } catch (printError) {
                        log.error('Print UPS Label Error', 'Failed to print label ' + labelUrls[i] + ': ' + printError.message);
                    }
                }

            } catch (e) {
                log.error('ERROR', 'Failed to print UPS labels: ' + e.message);
            }
        }

        /**
         * Update multiple package tracking numbers from UPS response
         *
         * @param {string} fulfillmentId The Item Fulfillment record ID
         * @param {Object} upsResponse The complete UPS API response
         * @param {string} labelUrlString Optional - pipe-delimited label URLs to store
         */
        function updateMultiplePackageTrackingNumbers(fulfillmentId, upsResponse, labelUrlString) {
            try {
                log.debug('Multiple Tracking Update', 'Starting tracking update for fulfillment: ' + fulfillmentId);

                // Extract tracking numbers from UPS response
                // UPS response structure: ShipmentResponse.ShipmentResults.PackageResults[]
                if (!upsResponse || !upsResponse.ShipmentResponse || !upsResponse.ShipmentResponse.ShipmentResults) {
                    log.error('Multiple Tracking Error', 'Invalid UPS response structure');
                    return;
                }

                var shipmentResults = upsResponse.ShipmentResponse.ShipmentResults;
                var packageResults = shipmentResults.PackageResults;

                // Handle single package (not an array)
                if (!Array.isArray(packageResults)) {
                    packageResults = [packageResults];
                }

                log.debug('Multiple Tracking Info', 'Found ' + packageResults.length + ' packages in UPS response');

                // Search PackShip records to get actual weights for each carton
                var packshipRecords = searchPackShipRecords(fulfillmentId);
                var cartonWeightMap = {}; // cartonName -> weight
                if (packshipRecords && packshipRecords.length > 0) {
                    var cartonGroups = groupPackShipByCarton(packshipRecords);
                    for (var cartonName in cartonGroups) {
                        var actualWeight = cartonGroups[cartonName][0].actualWeight || 0;
                        if (actualWeight > 0) {
                            cartonWeightMap[cartonName] = actualWeight;
                            log.debug('Carton Weight Map', 'Carton "' + cartonName + '": ' + actualWeight + ' lbs (actual weight from PackShip carton)');
                        } else {
                            // Fall back to calculated weight
                            var cartonData = calculateCartonData(cartonGroups[cartonName]);
                            cartonWeightMap[cartonName] = cartonData.weight;
                            log.debug('Carton Weight Map', 'Carton "' + cartonName + '": ' + cartonData.weight + ' lbs (calculated from item weights - no actual weight available)');
                        }
                    }
                }

                // Load the Item Fulfillment record for updating
                var recordForUpdate = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId
                });

                var packageCount = recordForUpdate.getLineCount({ sublistId: 'package' });
                log.debug('Multiple Tracking Info', 'Package lines in NetSuite: ' + packageCount);

                // Update tracking numbers and weights
                for (var i = 0; i < Math.min(packageCount, packageResults.length); i++) {
                    var trackingNumber = packageResults[i].TrackingNumber;

                    recordForUpdate.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: i,
                        value: trackingNumber
                    });

                    // Try to get carton name from package line and update weight
                    var cartonNumber = recordForUpdate.getSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagecartonnumber',
                        line: i
                    });

                    if (cartonNumber && cartonWeightMap[cartonNumber]) {
                        recordForUpdate.setSublistValue({
                            sublistId: 'package',
                            fieldId: 'packageweight',
                            line: i,
                            value: cartonWeightMap[cartonNumber]
                        });
                        log.debug('Tracking Update', 'Package ' + (i + 1) + ' (' + cartonNumber + '): tracking=' + trackingNumber + ', weight=' + cartonWeightMap[cartonNumber]);
                    } else {
                        log.debug('Tracking Update', 'Package ' + (i + 1) + ': tracking=' + trackingNumber + ' (no weight update - carton not found in PackShip)');
                    }
                }

                // Also set the shipping label URL if provided
                if (labelUrlString) {
                    recordForUpdate.setValue({
                        fieldId: 'custbody_shipping_label_url',
                        value: labelUrlString
                    });
                    log.debug('Label URL Update', 'Setting custbody_shipping_label_url: ' + labelUrlString);
                }

                // Set ship status to Shipped (C)
                recordForUpdate.setValue({
                    fieldId: 'shipstatus',
                    value: 'C'  // C = Shipped
                });
                log.debug('Ship Status Update', 'Setting shipstatus to C (Shipped)');

                recordForUpdate.save();
                log.debug('Multiple Tracking Success', 'Updated ' + Math.min(packageCount, packageResults.length) + ' tracking numbers');

            } catch (e) {
                log.error('Multiple Tracking Error', 'Error updating package tracking numbers: ' + e.message + '\nStack: ' + e.stack);
            }
        }

        /**
         * Search for PackShip - Packed Item records by Item Fulfillment ID
         *
         * @param {string} fulfillmentId The Item Fulfillment record ID
         * @returns {Array} Array of PackShip record data
         */
        function searchPackShipRecords(fulfillmentId) {
            try {
                var packshipSearch = search.create({
                    type: 'customrecord_packship_cartonitem',
                    filters: [
                        ['custrecord_packship_itemfulfillment', 'anyof', fulfillmentId]
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({
                            name: 'custrecord_packship_carton',
                            sort: search.Sort.ASC
                        }),
                        'custrecord_packship_fulfillmentitem',
                        'custrecord_packship_totalpackedqty',
                        search.createColumn({
                            name: 'name',
                            join: 'custrecord_packship_carton',
                            label: 'Carton Name'
                        }),
                        // Join to get the actual weight from the PackShip - Pack Carton record
                        search.createColumn({
                            name: 'custrecord_packship_cartonactualweight',
                            join: 'custrecord_packship_carton',
                            label: 'Carton Actual Weight'
                        })
                    ]
                });

                var searchResults = packshipSearch.run().getRange({
                    start: 0,
                    end: 1000
                });

                var packshipRecords = [];
                for (var i = 0; i < searchResults.length; i++) {
                    var result = searchResults[i];
                    var cartonRecordId = result.getValue('custrecord_packship_carton');
                    var itemValue = result.getValue('custrecord_packship_fulfillmentitem');
                    var quantityValue = result.getValue('custrecord_packship_totalpackedqty');
                    var cartonName = result.getValue({
                        name: 'name',
                        join: 'custrecord_packship_carton'
                    });

                    // Get the actual weight from the joined PackShip - Pack Carton record
                    var actualWeight = parseFloat(result.getValue({
                        name: 'custrecord_packship_cartonactualweight',
                        join: 'custrecord_packship_carton'
                    })) || 0;

                    packshipRecords.push({
                        id: result.getValue('internalid'),
                        carton: cartonName,
                        cartonRecordId: cartonRecordId,
                        item: itemValue,
                        quantity: parseFloat(quantityValue) || 0,
                        actualWeight: actualWeight // Actual weight from carton record
                    });

                    log.debug('PackShip Record', 'ID: ' + result.getValue('internalid') +
                        ', Carton: "' + cartonName + '", Item: ' + itemValue + ', Qty: ' + quantityValue +
                        ', Actual Weight: ' + actualWeight);
                }

                log.debug('PackShip Search', 'Found ' + packshipRecords.length + ' records for fulfillment ' + fulfillmentId);
                return packshipRecords;

            } catch (e) {
                log.error('PackShip Search Error', 'Error searching PackShip records: ' + e.message);
                return [];
            }
        }

        /**
         * Group PackShip records by carton field
         *
         * @param {Array} packshipRecords Array of PackShip record data
         * @returns {Object} Object with carton IDs as keys and arrays of records as values
         */
        function groupPackShipByCarton(packshipRecords) {
            var cartonGroups = {};

            for (var i = 0; i < packshipRecords.length; i++) {
                var packshipRecord = packshipRecords[i];
                var cartonId = packshipRecord.carton;

                if (!cartonId) {
                    log.debug('PackShip Carton Warning', 'PackShip record ID ' + packshipRecord.id + ' has no carton, skipping');
                    continue;
                }

                cartonId = String(cartonId).trim();
                if (!cartonId || !/^[A-Za-z0-9\-_]+$/.test(cartonId)) {
                    log.debug('PackShip Carton Warning', 'Invalid carton name: "' + cartonId + '"');
                    continue;
                }

                if (!cartonGroups[cartonId]) {
                    cartonGroups[cartonId] = [];
                }

                packshipRecord.carton = cartonId;
                cartonGroups[cartonId].push(packshipRecord);
            }

            return cartonGroups;
        }

        /**
         * Calculate carton weight and dimensions from PackShip records
         * Uses same logic as FedEx: sum weights, use largest volume item dimensions
         *
         * @param {Array} packshipRecords Array of PackShip records for this carton
         * @returns {Object} { weight: number, dimensions: { length, width, height } }
         */
        function calculateCartonData(packshipRecords) {
            log.debug('Carton Data Calculation', 'Calculating for ' + packshipRecords.length + ' items');

            var totalWeight = 0;
            var largestVolume = 0;
            var bestDimensions = { length: 0, width: 0, height: 0 };

            for (var i = 0; i < packshipRecords.length; i++) {
                var packshipRecord = packshipRecords[i];

                if (!packshipRecord.item || !packshipRecord.quantity || packshipRecord.quantity <= 0) {
                    continue;
                }

                try {
                    // Load the item record
                    var itemRecord;
                    var itemTypes = ['inventoryitem', 'kititem'];
                    var loadSuccess = false;

                    for (var t = 0; t < itemTypes.length; t++) {
                        try {
                            itemRecord = record.load({
                                type: itemTypes[t],
                                id: packshipRecord.item
                            });
                            loadSuccess = true;
                            break;
                        } catch (typeError) {
                            // Continue to next type
                        }
                    }

                    if (!loadSuccess) {
                        log.debug('Carton Data Warning', 'Could not load item ' + packshipRecord.item);
                        continue;
                    }

                    // WEIGHT CALCULATION - from item 'weight' field
                    var itemWeight = parseFloat(itemRecord.getValue({ fieldId: 'weight' })) || 0;
                    var itemTotalWeight = itemWeight * packshipRecord.quantity;
                    totalWeight += itemTotalWeight;

                    log.debug('Carton Weight', 'Item ' + packshipRecord.item + ': ' + itemWeight + ' lbs x ' + packshipRecord.quantity + ' = ' + itemTotalWeight + ' lbs');

                    // DIMENSION CALCULATION - from custom item fields (same as FedEx)
                    var parsedWidth = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_width' })) || 0;
                    var parsedLength = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_length' })) || 0;
                    var parsedHeight = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_height' })) || 0;

                    var volume = parsedWidth * parsedLength * parsedHeight;

                    log.debug('Carton Dimensions', 'Item ' + packshipRecord.item + ': ' + parsedLength + 'x' + parsedWidth + 'x' + parsedHeight + ' (vol: ' + volume + ')');

                    // Use largest volume item's dimensions
                    if (volume > largestVolume) {
                        largestVolume = volume;
                        bestDimensions = {
                            length: parsedLength,
                            width: parsedWidth,
                            height: parsedHeight
                        };
                    }

                } catch (itemError) {
                    log.error('Carton Data Item Error', 'Failed to process item ' + packshipRecord.item + ': ' + itemError.message);
                }
            }

            // Apply minimum weight of 1 lb per carton
            if (totalWeight < 1) {
                totalWeight = 1;
                log.debug('Carton Weight Adjustment', 'Weight < 1 lb, adjusted to 1 lb minimum');
            }

            // Apply minimum dimensions if all are 0
            if (bestDimensions.length === 0 && bestDimensions.width === 0 && bestDimensions.height === 0) {
                bestDimensions = { length: 10, width: 10, height: 10 };
                log.debug('Carton Dimensions Fallback', 'No dimensions found, using default 10x10x10');
            }

            log.debug('Carton Data Final', 'Weight: ' + totalWeight + ' lbs, Dimensions: ' +
                bestDimensions.length + 'x' + bestDimensions.width + 'x' + bestDimensions.height);

            return {
                weight: totalWeight,
                dimensions: bestDimensions
            };
        }

        /**
         * Calculate only dimensions for a carton (used when actual weight is available)
         * This is a lightweight version that still needs item records for dimensions
         *
         * @param {Array} packshipRecords Array of packship records for one carton
         * @returns {Object} Dimensions object { length, width, height }
         */
        function calculateCartonDimensions(packshipRecords) {
            var largestVolume = 0;
            var bestDimensions = { length: 0, width: 0, height: 0 };

            for (var i = 0; i < packshipRecords.length; i++) {
                var packshipRecord = packshipRecords[i];

                if (!packshipRecord.item || !packshipRecord.quantity || packshipRecord.quantity <= 0) {
                    continue;
                }

                try {
                    // Load the item record
                    var itemRecord;
                    var itemTypes = ['inventoryitem', 'kititem'];
                    var loadSuccess = false;

                    for (var t = 0; t < itemTypes.length; t++) {
                        try {
                            itemRecord = record.load({
                                type: itemTypes[t],
                                id: packshipRecord.item
                            });
                            loadSuccess = true;
                            break;
                        } catch (typeError) {
                            // Continue to next type
                        }
                    }

                    if (!loadSuccess) {
                        continue;
                    }

                    // DIMENSION CALCULATION - from custom item fields
                    var parsedWidth = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_width' })) || 0;
                    var parsedLength = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_length' })) || 0;
                    var parsedHeight = parseFloat(itemRecord.getValue({ fieldId: 'custitem_fmt_shipping_height' })) || 0;

                    var volume = parsedWidth * parsedLength * parsedHeight;

                    // Use largest volume item's dimensions
                    if (volume > largestVolume) {
                        largestVolume = volume;
                        bestDimensions = {
                            length: parsedLength,
                            width: parsedWidth,
                            height: parsedHeight
                        };
                    }

                } catch (itemError) {
                    log.error('Carton Dimensions Item Error', 'Failed to process item ' + packshipRecord.item + ': ' + itemError.message);
                }
            }

            // Apply minimum dimensions if all are 0
            if (bestDimensions.length === 0 && bestDimensions.width === 0 && bestDimensions.height === 0) {
                bestDimensions = { length: 10, width: 10, height: 10 };
            }

            return bestDimensions;
        }

        /**
         * Process reference value - handles formula substitution like {fieldname}
         * Retrieves field values from the Sales Order linked to the fulfillment
         *
         * @param {string} referenceValue The reference value (may contain {fieldname} formulas)
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {string} Processed reference value with formulas replaced
         */
        function processReferenceValue(referenceValue, fulfillmentRecord) {
            try {
                if (!referenceValue) {
                    return '';
                }

                // Check if value contains formula syntax {fieldname}
                var formulaMatch = referenceValue.match(/^\{(.+)\}$/);
                if (!formulaMatch) {
                    // No formula, return as-is
                    return referenceValue;
                }

                var fieldName = formulaMatch[1];
                log.debug('processReferenceValue', 'Found formula field: ' + fieldName);

                // Try to get value from fulfillment record first
                try {
                    var fulfillmentValue = fulfillmentRecord.getValue({ fieldId: fieldName });
                    if (fulfillmentValue) {
                        log.debug('processReferenceValue', 'Found value on fulfillment: ' + fulfillmentValue);
                        return String(fulfillmentValue);
                    }
                } catch (e) {
                    // Field not on fulfillment, try Sales Order
                }

                // Get linked Sales Order and retrieve value
                var createdFromId = fulfillmentRecord.getValue({ fieldId: 'createdfrom' });
                if (createdFromId) {
                    try {
                        var salesOrderRecord = record.load({
                            type: record.Type.SALES_ORDER,
                            id: createdFromId
                        });

                        var soValue = salesOrderRecord.getValue({ fieldId: fieldName });
                        if (soValue) {
                            log.debug('processReferenceValue', 'Found value on Sales Order: ' + soValue);
                            return String(soValue);
                        }
                    } catch (soError) {
                        log.debug('processReferenceValue', 'Could not load Sales Order or field: ' + soError.message);
                    }
                }

                // Field not found, return empty
                log.debug('processReferenceValue', 'Field "' + fieldName + '" not found, returning empty');
                return '';

            } catch (e) {
                log.error('processReferenceValue Error', 'Error processing reference value: ' + e.message);
                return referenceValue || '';
            }
        }

        /**
         * Build customer references array for UPS payload
         * Sources values from custrecord_hyc_ship_lbl_customer_ref_1 and custrecord_hyc_ship_lbl_customer_ref_2
         *
         * UPS Reference Number format:
         * - Code "00" = Customer Reference (or other codes like "01" = P.O. Number, "02" = Invoice Number)
         *
         * @param {Object} mappingRecord The shipping label mapping record
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Array|null} Array of UPS ReferenceNumber objects or null if none
         */
        function buildCustomerReferences(mappingRecord, fulfillmentRecord) {
            try {
                if (!mappingRecord) {
                    log.debug('buildCustomerReferences', 'No mapping record, skipping references');
                    return null;
                }

                var references = [];

                // Get reference values from mapping record
                var ref1 = mappingRecord.getValue('custrecord_hyc_ship_lbl_customer_ref_1');
                var ref2 = mappingRecord.getValue('custrecord_hyc_ship_lbl_customer_ref_2');

                log.debug('buildCustomerReferences', 'Raw ref1: ' + ref1 + ', ref2: ' + ref2);

                // Process reference 1
                if (ref1) {
                    var processedRef1 = processReferenceValue(ref1, fulfillmentRecord);
                    if (processedRef1) {
                        references.push({
                            Code: '00', // Customer Reference
                            Value: processedRef1.substring(0, 35) // UPS max length is 35 characters
                        });
                        log.debug('buildCustomerReferences', 'Added reference 1: ' + processedRef1);
                    }
                }

                // Process reference 2
                if (ref2) {
                    var processedRef2 = processReferenceValue(ref2, fulfillmentRecord);
                    if (processedRef2) {
                        references.push({
                            Code: '00', // Customer Reference
                            Value: processedRef2.substring(0, 35) // UPS max length is 35 characters
                        });
                        log.debug('buildCustomerReferences', 'Added reference 2: ' + processedRef2);
                    }
                }

                if (references.length === 0) {
                    log.debug('buildCustomerReferences', 'No references to add');
                    return null;
                }

                log.debug('buildCustomerReferences', 'Built ' + references.length + ' references');
                return references;

            } catch (e) {
                log.error('buildCustomerReferences Error', 'Error building customer references: ' + e.message);
                return null;
            }
        }

        /**
         * Build UPS Payment Information section
         * Supports both BillShipper (default) and BillThirdParty
         *
         * @param {boolean} isBillToThirdParty Whether to bill to third party
         * @param {Object} mappingRecord The shipping label mapping record
         * @param {string} wcAccountNumber Water Creation UPS account number
         * @param {string} thirdPartyAccountNumber Third party account number
         * @returns {Object} UPS PaymentInformation object
         */
        function buildPaymentInformation(isBillToThirdParty, mappingRecord, wcAccountNumber, thirdPartyAccountNumber) {
            try {
                if (isBillToThirdParty && mappingRecord) {
                    log.debug('DEBUG', 'buildPaymentInformation()::IS_TEST_MODE = ' + IS_TEST_MODE);
                    log.debug('DEBUG', 'buildPaymentInformation()::thirdPartyAccountNumber = ' + thirdPartyAccountNumber);

                    // In test mode, fall back to BillShipper because UPS rejects
                    // BillThirdParty when the account is the same as ShipperNumber
                    if (IS_TEST_MODE) {
                        log.debug('DEBUG', 'buildPaymentInformation()::Test mode - using BillShipper instead of BillThirdParty');
                        return {
                            ShipmentCharge: {
                                Type: '01',
                                BillShipper: {
                                    AccountNumber: wcAccountNumber
                                }
                            }
                        };
                    }

                    // Production mode: Use actual third party billing
                    var thirdPartyBillAddrJson = mappingRecord.getValue('custrecord_hyc_ship_lbl_3p_bill_addr');
                    log.debug('DEBUG', 'buildPaymentInformation()::thirdPartyBillAddrJson = ' + thirdPartyBillAddrJson);

                    if (thirdPartyBillAddrJson) {
                        var thirdPartyInfo = JSON.parse(thirdPartyBillAddrJson);

                        log.debug('DEBUG', 'buildPaymentInformation()::Using BillThirdParty with account: ' + thirdPartyAccountNumber);

                        // UPS BillThirdParty structure (ShipmentCharge is an object, not array)
                        return {
                            ShipmentCharge: {
                                Type: '01', // Transportation charges
                                BillThirdParty: {
                                    AccountNumber: thirdPartyAccountNumber,
                                    Address: {
                                        PostalCode: thirdPartyInfo.address ? thirdPartyInfo.address.postalCode : '',
                                        CountryCode: thirdPartyInfo.address ? thirdPartyInfo.address.countryCode : 'US'
                                    }
                                }
                            }
                        };
                    }
                }

                // Default: Bill to shipper (Water Creation)
                log.debug('DEBUG', 'buildPaymentInformation()::Using BillShipper (default)');
                return {
                    ShipmentCharge: {
                        Type: '01',
                        BillShipper: {
                            AccountNumber: wcAccountNumber
                        }
                    }
                };

            } catch (e) {
                log.error('ERROR', 'Failed to build payment information: ' + e.message);
                // Fallback to BillShipper on error
                return {
                    ShipmentCharge: {
                        Type: '01',
                        BillShipper: {
                            AccountNumber: wcAccountNumber
                        }
                    }
                };
            }
        }

        /**
         * Build UPS Shipment payload
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} UPS ShipmentRequest payload
         */
        function buildShipmentPayload(fulfillmentRecord) {
            try {
                log.debug('buildShipmentPayload', 'Building payload for fulfillment: ' + fulfillmentRecord.id);

                var isBillToThirdParty = false;

                // Get shipping label mapping record
                var mappingRecord = getShippingLabelMapping(fulfillmentRecord);

                // Get WC account number from config
                var tokenRecord = getTokenRecord();
                var wcAccountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_account_number' });
                var thirdPartyAccountNumber = null;

                // Check if this is a third party billing scenario
                // If mapping record is not the default WC record (ID 10), it's third party
                if (mappingRecord && mappingRecord.id && mappingRecord.id !== WC_UPS_MAPPING_RECORD_ID) {
                    thirdPartyAccountNumber = mappingRecord.getValue('custrecord_hyc_ship_lbl_account_no');
                    isBillToThirdParty = true;
                    log.debug('buildShipmentPayload', 'Third party billing detected. Account: ' + thirdPartyAccountNumber);
                }

                if (isBillToThirdParty && !thirdPartyAccountNumber) {
                    log.audit('buildShipmentPayload', 'Third party mapping found but no account number, falling back to BillShipper');
                    isBillToThirdParty = false;
                }

                // Get shipper and recipient info
                var shipperInfo = buildShipperInfo(fulfillmentRecord, mappingRecord);
                var recipientInfo = buildRecipientInfo(fulfillmentRecord);

                // Get service code
                var shipMethodId = fulfillmentRecord.getValue({ fieldId: 'shipmethod' });
                var serviceCode = getUPSServiceCode(shipMethodId);

                log.debug('buildShipmentPayload', 'wcAccountNumber: ' + wcAccountNumber +
                    ', isBillToThirdParty: ' + isBillToThirdParty +
                    ', thirdPartyAccountNumber: ' + thirdPartyAccountNumber);

                // Get reference numbers
                var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' }) || '';

                // Build customer references from mapping record
                var customerReferences = buildCustomerReferences(mappingRecord, fulfillmentRecord);
                log.debug('buildShipmentPayload', 'Customer references: ' + JSON.stringify(customerReferences));

                // Build packages from PackShip records (same approach as FedEx)
                var packages = [];
                var packshipRecords = searchPackShipRecords(fulfillmentRecord.id);

                if (packshipRecords && packshipRecords.length > 0) {
                    // Group by carton and calculate weight/dimensions
                    var cartonGroups = groupPackShipByCarton(packshipRecords);
                    var cartonKeys = Object.keys(cartonGroups);

                    log.debug('buildShipmentPayload', 'Found ' + cartonKeys.length + ' cartons from PackShip records');

                    for (var c = 0; c < cartonKeys.length; c++) {
                        var cartonId = cartonKeys[c];
                        var cartonRecords = cartonGroups[cartonId];

                        // Check if actual weight is available from PackShip carton record
                        var actualWeight = cartonRecords[0].actualWeight || 0;

                        var weight, dimensions;
                        if (actualWeight > 0) {
                            // Use actual weight from carton record, only calculate dimensions
                            weight = actualWeight;
                            dimensions = calculateCartonDimensions(cartonRecords);
                            log.debug('Carton Weight Source', 'Using actual weight for carton "' + cartonId + '": ' + weight + ' lbs');
                        } else {
                            // Fall back to calculated weight/dimensions from item records
                            var cartonData = calculateCartonData(cartonRecords);
                            weight = cartonData.weight;
                            dimensions = cartonData.dimensions;
                            log.debug('Carton Weight Source', 'Using calculated weight for carton "' + cartonId + '": ' + weight + ' lbs (actual weight not available)');
                        }

                        var packageObj = {
                            Description: 'Package ' + (c + 1) + ' - ' + cartonId,
                            Packaging: {
                                Code: '02',
                                Description: 'Customer Supplied Package'
                            },
                            Dimensions: {
                                UnitOfMeasurement: {
                                    Code: 'IN',
                                    Description: 'Inches'
                                },
                                Length: String(Math.ceil(dimensions.length) || 10),
                                Width: String(Math.ceil(dimensions.width) || 10),
                                Height: String(Math.ceil(dimensions.height) || 10)
                            },
                            PackageWeight: {
                                UnitOfMeasurement: {
                                    Code: 'LBS',
                                    Description: 'Pounds'
                                },
                                Weight: String(weight)
                            }
                        };

                        // Add customer references if available
                        if (customerReferences && customerReferences.length > 0) {
                            packageObj.ReferenceNumber = customerReferences;
                        }

                        packages.push(packageObj);
                    }
                }

                // Fallback: If no PackShip records, use package sublist
                if (packages.length === 0) {
                    log.debug('buildShipmentPayload', 'No PackShip records found, using package sublist fallback');
                    var packageCount = fulfillmentRecord.getLineCount({ sublistId: 'package' });

                    for (var i = 0; i < packageCount; i++) {
                        var weight = parseFloat(fulfillmentRecord.getSublistValue({
                            sublistId: 'package',
                            fieldId: 'packageweight',
                            line: i
                        })) || 1;

                        var fallbackPackageObj = {
                            Description: 'Package ' + (i + 1),
                            Packaging: {
                                Code: '02',
                                Description: 'Customer Supplied Package'
                            },
                            Dimensions: {
                                UnitOfMeasurement: {
                                    Code: 'IN',
                                    Description: 'Inches'
                                },
                                Length: '10',
                                Width: '10',
                                Height: '10'
                            },
                            PackageWeight: {
                                UnitOfMeasurement: {
                                    Code: 'LBS',
                                    Description: 'Pounds'
                                },
                                Weight: String(weight)
                            }
                        };

                        // Add customer references if available
                        if (customerReferences && customerReferences.length > 0) {
                            fallbackPackageObj.ReferenceNumber = customerReferences;
                        }

                        packages.push(fallbackPackageObj);
                    }
                }

                // If still no packages, create a default one
                if (packages.length === 0) {
                    var defaultPackageObj = {
                        Description: 'Package 1',
                        Packaging: {
                            Code: '02',
                            Description: 'Customer Supplied Package'
                        },
                        Dimensions: {
                            UnitOfMeasurement: {
                                Code: 'IN',
                                Description: 'Inches'
                            },
                            Length: '10',
                            Width: '10',
                            Height: '10'
                        },
                        PackageWeight: {
                            UnitOfMeasurement: {
                                Code: 'LBS',
                                Description: 'Pounds'
                            },
                            Weight: '1'
                        }
                    };

                    // Add customer references if available
                    if (customerReferences && customerReferences.length > 0) {
                        defaultPackageObj.ReferenceNumber = customerReferences;
                    }

                    packages.push(defaultPackageObj);
                }

                // Build the ShipmentRequest payload
                var payload = {
                    ShipmentRequest: {
                        Request: {
                            RequestOption: 'nonvalidate',
                            SubVersion: '1801',
                            TransactionReference: {
                                CustomerContext: tranId
                            }
                        },
                        Shipment: {
                            Description: 'Shipment for ' + tranId,
                            Shipper: {
                                Name: shipperInfo.Name || 'Water Creation',
                                AttentionName: shipperInfo.AttentionName || 'Shipping Department',
                                Phone: shipperInfo.Phone || { Number: WC_PHONE_NUMBER },
                                ShipperNumber: wcAccountNumber,
                                Address: shipperInfo.Address
                            },
                            ShipTo: {
                                Name: recipientInfo.Name || 'Customer',
                                AttentionName: recipientInfo.AttentionName || recipientInfo.Name || 'Customer',
                                Phone: recipientInfo.Phone || { Number: '9999999999' },
                                Address: recipientInfo.Address
                            },
                            ShipFrom: {
                                Name: shipperInfo.Name || 'Water Creation',
                                AttentionName: shipperInfo.AttentionName || 'Shipping Department',
                                Phone: shipperInfo.Phone || { Number: WC_PHONE_NUMBER },
                                Address: shipperInfo.Address
                            },
                            PaymentInformation: buildPaymentInformation(isBillToThirdParty, mappingRecord, wcAccountNumber, thirdPartyAccountNumber),
                            Service: {
                                Code: serviceCode,
                                Description: 'UPS Service'
                            },
                            Package: packages
                        },
                        LabelSpecification: {
                            LabelImageFormat: {
                                Code: 'ZPL',
                                Description: 'ZPL'
                            },
                            LabelStockSize: {
                                Height: '6',
                                Width: '4'
                            }
                        }
                    }
                };

                log.debug('buildShipmentPayload', 'Payload built successfully with ' + packages.length + ' packages');
                return payload;

            } catch (e) {
                log.error('buildShipmentPayload Error', 'Error building shipment payload: ' + e.message + '\nStack: ' + e.stack);
                throw e;
            }
        }

        /**
         * Build UPS Return Shipment payload for Pottery Barn orders
         * Uses UPS Print Return Label (PRL) service - Return Service Code '9'
         * For returns: Customer becomes Shipper, Williams Sonoma becomes ShipTo
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} outboundRecipientInfo The original recipient (customer) info
         * @param {Array} packages The packages array from outbound shipment
         * @returns {Object} UPS Return ShipmentRequest payload
         */
        /**
         * Build UPS Return Shipment payload for a SINGLE package
         * UPS Print Return Label only allows one package per shipment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} outboundRecipientInfo The original recipient (customer) info
         * @param {Object} singlePackage A single package object from the outbound shipment
         * @param {number} packageSequenceNumber The package sequence number (1-based)
         * @returns {Object} The return shipment payload
         */
        function buildReturnShipmentPayload(fulfillmentRecord, outboundRecipientInfo, singlePackage, packageSequenceNumber) {
            try {
                log.debug('buildReturnShipmentPayload', 'Building return shipment payload for package ' + packageSequenceNumber);

                // Get WC account number and check for third-party billing
                var tokenRecord = getTokenRecord();
                var wcAccountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_account_number' });

                var mappingRecord = getShippingLabelMapping(fulfillmentRecord);
                var isBillToThirdParty = false;
                var thirdPartyAccountNumber = null;

                if (mappingRecord && mappingRecord.id && mappingRecord.id !== WC_UPS_MAPPING_RECORD_ID) {
                    thirdPartyAccountNumber = mappingRecord.getValue('custrecord_hyc_ship_lbl_account_no');
                    isBillToThirdParty = true;
                    log.debug('buildReturnShipmentPayload', 'Third party billing detected for return. Account: ' + thirdPartyAccountNumber);
                }

                var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' }) || '';

                // Build single package for return (UPS Print Return Label only allows 1 package)
                var returnPackage = {
                    Description: 'Return Package ' + packageSequenceNumber,
                    Packaging: singlePackage.Packaging,
                    Dimensions: singlePackage.Dimensions,
                    PackageWeight: singlePackage.PackageWeight
                    // Note: No ReferenceNumber for return labels
                };

                // Build the Return ShipmentRequest payload
                // For returns: addresses are swapped
                // - Shipper = Customer (return is coming FROM the customer)
                // - ShipTo = Williams Sonoma return center
                // - ShipFrom = Customer (origin of return)
                var payload = {
                    ShipmentRequest: {
                        Request: {
                            RequestOption: 'nonvalidate',
                            SubVersion: '1901',
                            TransactionReference: {
                                CustomerContext: 'Return-' + tranId + '-Pkg' + packageSequenceNumber
                            }
                        },
                        Shipment: {
                            Description: 'Return Shipment for ' + tranId + ' Package ' + packageSequenceNumber,
                            ReturnService: {
                                Code: '9',
                                Description: 'UPS Print Return Label'
                            },
                            // Customer becomes the shipper (returning from)
                            Shipper: {
                                Name: outboundRecipientInfo.Name || 'Customer',
                                AttentionName: outboundRecipientInfo.AttentionName || outboundRecipientInfo.Name || 'Customer',
                                Phone: outboundRecipientInfo.Phone || { Number: '9999999999' },
                                ShipperNumber: isBillToThirdParty ? thirdPartyAccountNumber : wcAccountNumber,
                                Address: outboundRecipientInfo.Address
                            },
                            // Williams Sonoma return center is the destination
                            ShipTo: {
                                Name: PB_RETURN_ADDRESS.Name,
                                AttentionName: PB_RETURN_ADDRESS.AttentionName,
                                Phone: PB_RETURN_ADDRESS.Phone,
                                Address: PB_RETURN_ADDRESS.Address
                            },
                            // ShipFrom is also the customer
                            ShipFrom: {
                                Name: outboundRecipientInfo.Name || 'Customer',
                                AttentionName: outboundRecipientInfo.AttentionName || outboundRecipientInfo.Name || 'Customer',
                                Phone: outboundRecipientInfo.Phone || { Number: '9999999999' },
                                Address: outboundRecipientInfo.Address
                            },
                            PaymentInformation: buildPaymentInformation(isBillToThirdParty, mappingRecord, wcAccountNumber, thirdPartyAccountNumber),
                            Service: {
                                Code: '03', // UPS Ground for returns
                                Description: 'UPS Ground'
                            },
                            Package: returnPackage
                        },
                        LabelSpecification: {
                            LabelImageFormat: {
                                Code: 'ZPL',
                                Description: 'ZPL'
                            },
                            LabelStockSize: {
                                Height: '6',
                                Width: '4'
                            }
                        }
                    }
                };

                log.debug('buildReturnShipmentPayload', 'Return payload built successfully for package ' + packageSequenceNumber);
                return payload;

            } catch (e) {
                log.error('buildReturnShipmentPayload Error', 'Error building return shipment payload: ' + e.message);
                throw e;
            }
        }

        /**
         * Create UPS Return Shipment via API for Pottery Barn orders
         * UPS Print Return Label only allows one package per shipment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} outboundRecipientInfo The original recipient (customer) info
         * @param {Object} singlePackage A single package object from outbound shipment
         * @param {number} packageSequenceNumber The package sequence number (1-based)
         * @returns {Object} Result with success, trackingNumber, labelUrls, etc.
         */
        function createReturnShipment(fulfillmentRecord, outboundRecipientInfo, singlePackage, packageSequenceNumber) {
            try {
                log.audit('createReturnShipment', 'Creating return shipment for Pottery Barn order, package ' + packageSequenceNumber);

                // Build return shipment payload for single package
                var payload = buildReturnShipmentPayload(fulfillmentRecord, outboundRecipientInfo, singlePackage, packageSequenceNumber);

                // Get authentication token and API URL
                var tokenRecord = getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var baseApiUrl = getApiUrl();

                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }

                // UPS Shipping API endpoint
                var apiUrl = baseApiUrl + 'api/shipments/v2409/ship';

                log.debug('createReturnShipment', 'API URL: ' + apiUrl);
                log.debug('createReturnShipment', 'Return Payload: ' + JSON.stringify(payload));

                // Make the API call
                var response = postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.debug('createReturnShipment', 'Response Status: ' + response.status);
                log.debug('createReturnShipment', 'Response: ' + JSON.stringify(response.result));

                // Process response
                if (response.status === 200 || response.status === 201) {
                    var returnResult = processReturnShipmentResponse(fulfillmentRecord, response.result, packageSequenceNumber);

                    log.audit('createReturnShipment Success', 'Return shipment created for package ' + packageSequenceNumber + '. Tracking: ' + returnResult.trackingNumber);

                    return {
                        success: true,
                        trackingNumber: returnResult.trackingNumber,
                        labelUrl: returnResult.labelUrl,
                        labelData: returnResult.labelData,
                        packageSequenceNumber: packageSequenceNumber
                    };
                } else {
                    log.error('createReturnShipment Error', 'UPS API returned status ' + response.status + ' for package ' + packageSequenceNumber);
                    return {
                        success: false,
                        message: 'UPS Return API returned status ' + response.status,
                        packageSequenceNumber: packageSequenceNumber
                    };
                }

            } catch (e) {
                log.error('createReturnShipment Error', 'Error creating return shipment: ' + e.message);
                return {
                    success: false,
                    message: e.message
                };
            }
        }

        /**
         * Process UPS Return Shipment Response for a SINGLE package
         * Saves return label and returns tracking/label info
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} apiResponse The UPS API response
         * @param {number} packageSequenceNumber The package sequence number (1-based)
         * @returns {Object} Processed result with trackingNumber and labelUrl
         */
        function processReturnShipmentResponse(fulfillmentRecord, apiResponse, packageSequenceNumber) {
            try {
                log.debug('processReturnShipmentResponse', 'Processing UPS return shipment response for package ' + packageSequenceNumber);

                var trackingNumber = '';
                var labelData = '';
                var labelUrl = '';

                // UPS response structure: ShipmentResponse.ShipmentResults
                if (apiResponse.ShipmentResponse && apiResponse.ShipmentResponse.ShipmentResults) {
                    var shipmentResults = apiResponse.ShipmentResponse.ShipmentResults;

                    // Get master tracking number
                    if (shipmentResults.ShipmentIdentificationNumber) {
                        trackingNumber = shipmentResults.ShipmentIdentificationNumber;
                    }

                    // Get package results (should be single package)
                    if (shipmentResults.PackageResults) {
                        var pkgResults = Array.isArray(shipmentResults.PackageResults)
                            ? shipmentResults.PackageResults
                            : [shipmentResults.PackageResults];

                        var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' }) || 'IF' + fulfillmentRecord.id;

                        // Process the single package result
                        var pkg = pkgResults[0];
                        if (pkg) {
                            var pkgTrackingNumber = pkg.TrackingNumber || '';

                            // Get label image (base64 encoded)
                            if (pkg.ShippingLabel && pkg.ShippingLabel.GraphicImage) {
                                labelData = pkg.ShippingLabel.GraphicImage;
                            }

                            // Use package tracking as master if not set
                            if (!trackingNumber && pkgTrackingNumber) {
                                trackingNumber = pkgTrackingNumber;
                            }

                            // Save return label to file cabinet with _RETURN suffix using original package sequence number
                            if (labelData) {
                                labelUrl = saveUPSLabel(
                                    labelData,
                                    tranId,
                                    packageSequenceNumber,
                                    'ZPL',
                                    true // isReturnLabel
                                );
                            }
                        }
                    }
                }

                log.debug('processReturnShipmentResponse', 'Return Tracking: ' + trackingNumber + ', Label URL: ' + labelUrl);

                return {
                    trackingNumber: trackingNumber,
                    labelData: labelData,
                    labelUrl: labelUrl
                };

            } catch (e) {
                log.error('processReturnShipmentResponse Error', 'Error processing return response: ' + e.message);
                return {
                    trackingNumber: '',
                    labelData: '',
                    labelUrls: []
                };
            }
        }

        /**
         * Create UPS Shipment via API
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {boolean} testMode If true, only validates but doesn't save to record
         * @returns {Object} Result with success, trackingNumber, labelData, etc.
         */
        function createShipment(fulfillmentRecord) {
            var startTime = Date.now();
            log.debug('createShipment', 'Starting shipment creation for fulfillment: ' + fulfillmentRecord.id + ' (IS_TEST_MODE=' + IS_TEST_MODE + ')');

            try {
                // Build the shipment payload
                var payload = buildShipmentPayload(fulfillmentRecord);

                // Get authentication token and API URL
                var tokenRecord = getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var baseApiUrl = getApiUrl();

                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }

                // UPS Shipping API endpoint (v2409)
                var apiUrl = baseApiUrl + 'api/shipments/v2409/ship';

                log.debug('createShipment', 'API URL: ' + apiUrl);
                log.debug('createShipment', 'Payload: ' + JSON.stringify(payload));

                // Make the API call
                var response = postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.debug('createShipment', 'Response Status: ' + response.status);
                log.debug('createShipment', 'Response: ' + JSON.stringify(response.result));

                // Process response
                if (response.status === 200 || response.status === 201) {
                    var result = processShipmentResponse(fulfillmentRecord, response.result);

                    var executionTime = Date.now() - startTime;
                    log.audit('createShipment Success', 'Shipment created in ' + executionTime + 'ms. Tracking: ' + result.trackingNumber);

                    var finalResult = {
                        success: true,
                        message: 'UPS shipment created successfully' + (IS_TEST_MODE ? ' (Test Mode)' : ''),
                        trackingNumber: result.trackingNumber,
                        labelData: result.labelData,
                        apiResponse: response.result,
                        executionTime: executionTime
                    };

                    // For Pottery Barn orders, create return labels (one per package)
                    // UPS Print Return Label only allows one package per shipment
                    // Return labels are created in both sandbox and production modes
                    if (isPotteryBarnOrder(fulfillmentRecord)) {
                        log.audit('createShipment', 'Pottery Barn order detected - creating return labels');

                        try {
                            // Get recipient info and packages from the payload
                            var recipientInfo = buildRecipientInfo(fulfillmentRecord);
                            var packages = payload.ShipmentRequest.Shipment.Package;

                            // Ensure packages is an array
                            if (!Array.isArray(packages)) {
                                packages = [packages];
                            }

                            var returnTrackingNumbers = [];
                            var returnLabelUrls = [];
                            var returnErrors = [];

                            // Create one return shipment per package
                            for (var pkgIdx = 0; pkgIdx < packages.length; pkgIdx++) {
                                var packageSequenceNumber = pkgIdx + 1;
                                try {
                                    log.debug('createShipment', 'Creating return label for package ' + packageSequenceNumber + ' of ' + packages.length);

                                    var returnResult = createReturnShipment(fulfillmentRecord, recipientInfo, packages[pkgIdx], packageSequenceNumber);

                                    if (returnResult.success) {
                                        returnTrackingNumbers.push(returnResult.trackingNumber);
                                        if (returnResult.labelUrl) {
                                            returnLabelUrls.push(returnResult.labelUrl);
                                        }
                                        log.audit('createShipment', 'Return label ' + packageSequenceNumber + ' created. Tracking: ' + returnResult.trackingNumber);
                                    } else {
                                        log.error('createShipment', 'Failed to create return label ' + packageSequenceNumber + ': ' + returnResult.message);
                                        returnErrors.push('Package ' + packageSequenceNumber + ': ' + returnResult.message);
                                    }
                                } catch (pkgReturnError) {
                                    log.error('createShipment', 'Error creating return label ' + packageSequenceNumber + ': ' + pkgReturnError.message);
                                    returnErrors.push('Package ' + packageSequenceNumber + ': ' + pkgReturnError.message);
                                }
                            }

                            // Only print return labels in production mode (skip printing in test/sandbox mode)
                            if (!IS_TEST_MODE && returnLabelUrls.length > 0) {
                                printUPSLabels(returnLabelUrls);
                                log.audit('createShipment', 'Printed ' + returnLabelUrls.length + ' return labels');
                            }

                            // Update custbody_shipping_label_url with return label URLs
                            if (returnLabelUrls.length > 0) {
                                try {
                                    // Load current label URL value
                                    var fulfillmentId = fulfillmentRecord.id;
                                    var currentLabelUrl = search.lookupFields({
                                        type: 'itemfulfillment',
                                        id: fulfillmentId,
                                        columns: ['custbody_shipping_label_url']
                                    }).custbody_shipping_label_url || '';

                                    // Append return label URLs
                                    var returnLabelUrlString = returnLabelUrls.join('|||');
                                    var combinedLabelUrls = currentLabelUrl
                                        ? currentLabelUrl + '|||' + returnLabelUrlString
                                        : returnLabelUrlString;

                                    // Save updated value
                                    record.submitFields({
                                        type: 'itemfulfillment',
                                        id: fulfillmentId,
                                        values: {
                                            'custbody_shipping_label_url': combinedLabelUrls
                                        }
                                    });

                                    log.audit('createShipment', 'Updated custbody_shipping_label_url with ' + returnLabelUrls.length + ' return label URLs');
                                } catch (urlUpdateError) {
                                    log.error('createShipment', 'Error updating return label URLs: ' + urlUpdateError.message);
                                }
                            }

                            // Store results
                            if (returnTrackingNumbers.length > 0) {
                                finalResult.returnTrackingNumbers = returnTrackingNumbers;
                                finalResult.returnLabelUrls = returnLabelUrls;
                                finalResult.message += ' + ' + returnTrackingNumbers.length + ' return label(s) created';
                                log.audit('createShipment', 'Return labels created successfully. Tracking: ' + returnTrackingNumbers.join(', '));
                            }

                            if (returnErrors.length > 0) {
                                finalResult.returnLabelErrors = returnErrors;
                                log.error('createShipment', 'Some return labels failed: ' + returnErrors.join('; '));
                            }

                        } catch (returnError) {
                            log.error('createShipment', 'Error creating return labels: ' + returnError.message);
                            finalResult.returnLabelError = returnError.message;
                        }
                    }

                    return finalResult;
                } else {
                    throw error.create({
                        name: 'UPS_SHIP_API_ERROR',
                        message: 'UPS Ship API returned status ' + response.status + ': ' + JSON.stringify(response.result)
                    });
                }

            } catch (e) {
                var executionTime = Date.now() - startTime;
                log.error('createShipment Error', 'Error creating shipment: ' + e.message + '\nStack: ' + e.stack);

                return {
                    success: false,
                    message: e.message,
                    executionTime: executionTime
                };
            }
        }

        /**
         * Process UPS Shipment Response
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} apiResponse The UPS API response
         * @param {boolean} testMode If true, doesn't save to record
         * @returns {Object} Processed result with trackingNumber and labelData
         */
        function processShipmentResponse(fulfillmentRecord, apiResponse) {
            try {
                log.debug('processShipmentResponse', 'Processing UPS shipment response (IS_TEST_MODE=' + IS_TEST_MODE + ')');

                var trackingNumber = '';
                var labelData = '';
                var packageResults = [];

                // UPS response structure: ShipmentResponse.ShipmentResults
                if (apiResponse.ShipmentResponse && apiResponse.ShipmentResponse.ShipmentResults) {
                    var shipmentResults = apiResponse.ShipmentResponse.ShipmentResults;

                    // Get master tracking number
                    if (shipmentResults.ShipmentIdentificationNumber) {
                        trackingNumber = shipmentResults.ShipmentIdentificationNumber;
                    }

                    // Get package results (may have multiple packages)
                    if (shipmentResults.PackageResults) {
                        var pkgResults = Array.isArray(shipmentResults.PackageResults)
                            ? shipmentResults.PackageResults
                            : [shipmentResults.PackageResults];

                        for (var i = 0; i < pkgResults.length; i++) {
                            var pkg = pkgResults[i];
                            var pkgTrackingNumber = pkg.TrackingNumber || '';
                            var pkgLabelData = '';

                            // Get label image (base64 encoded)
                            if (pkg.ShippingLabel && pkg.ShippingLabel.GraphicImage) {
                                pkgLabelData = pkg.ShippingLabel.GraphicImage;
                            }

                            packageResults.push({
                                TrackingNumber: pkgTrackingNumber,
                                LabelData: pkgLabelData
                            });

                            // Use first package tracking as master if not set
                            if (!trackingNumber && pkgTrackingNumber) {
                                trackingNumber = pkgTrackingNumber;
                            }

                            // Concatenate label data
                            if (pkgLabelData) {
                                labelData += (labelData ? '\n' : '') + pkgLabelData;
                            }
                        }
                    }
                }

                log.debug('processShipmentResponse', 'Tracking: ' + trackingNumber + ', Packages: ' + packageResults.length);

                // Always update fulfillment record (regardless of test mode)
                // Labels are saved and tracking numbers updated in both sandbox and production
                if (trackingNumber) {
                    try {
                        // Save labels to file cabinet FIRST and collect URLs
                        var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' }) || 'IF' + fulfillmentRecord.id;
                        var labelUrls = [];
                        for (var j = 0; j < packageResults.length; j++) {
                            if (packageResults[j].LabelData) {
                                var labelUrl = saveUPSLabel(
                                    packageResults[j].LabelData,  // base64Data
                                    tranId,                        // salesOrderNumber/tranId for filename
                                    j + 1,                         // packageSequenceNumber
                                    'ZPL'                          // labelFormat
                                );
                                if (labelUrl) {
                                    labelUrls.push(labelUrl);
                                }
                            }
                        }
                        var labelUrlString = labelUrls.length > 0 ? labelUrls.join('|||') : '';

                        // Update tracking numbers AND label URL in ONE save operation
                        if (packageResults.length > 0) {
                            updateMultiplePackageTrackingNumbers(fulfillmentRecord.id, apiResponse, labelUrlString);
                        }

                        // Only print in production mode (skip printing in test/sandbox mode)
                        if (!IS_TEST_MODE && labelUrls.length > 0) {
                            printUPSLabels(labelUrls);
                        }

                        log.audit('processShipmentResponse', 'Updated fulfillment with tracking and ' + labelUrls.length + ' label URLs');
                    } catch (updateError) {
                        log.error('processShipmentResponse', 'Error updating fulfillment: ' + updateError.message);
                    }
                }

                return {
                    trackingNumber: trackingNumber,
                    labelData: labelData,
                    packageResults: packageResults
                };

            } catch (e) {
                log.error('processShipmentResponse Error', 'Error processing response: ' + e.message);
                throw e;
            }
        }

        return {
            setTestMode: setTestMode,
            getTestMode: getTestMode,
            getCurrentConfigRecordId: getCurrentConfigRecordId,
            getApiUrl: getApiUrl,
            getTokenRecord: getTokenRecord,
            validateToken: validateToken,
            refreshToken: refreshToken,
            updateAccessToken: updateAccessToken,
            postToApi: postToApi,
            getFromApi: getFromApi,
            getShippingLabelMapping: getShippingLabelMapping,
            validatePhoneNumber: validatePhoneNumber,
            extractCartonSequenceNumber: extractCartonSequenceNumber,
            getCurrentDateString: getCurrentDateString,
            getCurrentDateForFilename: getCurrentDateForFilename,
            getUPSServiceCode: getUPSServiceCode,
            getShipMethodMappingById: getShipMethodMappingById,
            getShipMethodMapping: getShipMethodMapping,
            buildShipperInfo: buildShipperInfo,
            buildRecipientInfo: buildRecipientInfo,
            processReferenceValue: processReferenceValue,
            buildCustomerReferences: buildCustomerReferences,
            buildShipmentPayload: buildShipmentPayload,
            createShipment: createShipment,
            processShipmentResponse: processShipmentResponse,
            saveUPSLabel: saveUPSLabel,
            getUPSLabelFolderId: getUPSLabelFolderId,
            printUPSLabels: printUPSLabels,
            updateMultiplePackageTrackingNumbers: updateMultiplePackageTrackingNumbers,
            // Pottery Barn return label functions
            isPotteryBarnOrder: isPotteryBarnOrder,
            buildReturnShipmentPayload: buildReturnShipmentPayload,
            createReturnShipment: createReturnShipment,
            processReturnShipmentResponse: processReturnShipmentResponse,
            // Constants for external reference
            POTTERY_BARN_CUSTOMER_ID: POTTERY_BARN_CUSTOMER_ID,
            PB_RETURN_ADDRESS: PB_RETURN_ADDRESS
        };
    }
);
