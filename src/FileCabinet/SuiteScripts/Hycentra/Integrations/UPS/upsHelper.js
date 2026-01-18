/*
 * upsHelper.js
 * UPS API helper functions - OAuth, API communication, utilities
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/runtime', 'N/record', 'N/format', 'N/https', 'N/error', 'N/log', 'N/file', 'N/search', 'N/encode', '../../../Concentrus/PackShipTemplate/Con_Lib_Print_Node.js'],
    function (runtime, record, format, https, error, log, file, search, encode, printNodeLib) {
        const CONFIG_RECORD_TYPE = 'customrecord_hyc_ups_config';
        const SANDBOX_CONFIG_RECORD_ID = 1; // UPS Sandbox config record ID
        const PRODUCTION_CONFIG_RECORD_ID = 2; // UPS Production config record ID
        const WC_UPS_MAPPING_RECORD_ID = 11; // HYC Shipping Label Mapping List (Default Account)
        const WC_PHONE_NUMBER = '9097731777';

        // Module-level variable to store test mode flag
        var IS_TEST_MODE = false;

        /**
         * Set test mode flag
         *
         * @param {boolean} testMode Whether to use sandbox configuration
         */
        function setTestMode(testMode) {
            IS_TEST_MODE = testMode;
            log.debug('UPS Test Mode', 'Test mode set to: ' + IS_TEST_MODE);
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
            try {
                var configRecordId = getCurrentConfigRecordId();
                log.debug('DEBUG', 'getApiUrl()::IS_TEST_MODE = ' + IS_TEST_MODE + ', using config record ID = ' + configRecordId);

                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId
                });

                if (!tokenRecord.isEmpty) {
                    var endpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_endpoint' });
                    // Ensure endpoint ends with trailing slash
                    if (endpoint && !endpoint.endsWith('/')) {
                        endpoint = endpoint + '/';
                        log.debug('DEBUG', 'Added trailing slash to endpoint: ' + endpoint);
                    }
                    return endpoint || 'https://onlinetools.ups.com/';
                } else {
                    return 'https://onlinetools.ups.com/'; // Production endpoint
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error getting API URL, using default: ' + e.message
                });
                return 'https://onlinetools.ups.com/'; // Fallback to production
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
         * @returns {string} File URL if successful, null if failed
         */
        function saveUPSLabel(base64Data, salesOrderNumber, packageSequenceNumber, labelFormat) {
            try {
                log.debug('DEBUG', 'saveUPSLabel()::salesOrderNumber = ' + salesOrderNumber);
                log.debug('DEBUG', 'saveUPSLabel()::packageSequenceNumber = ' + packageSequenceNumber);
                log.debug('DEBUG', 'saveUPSLabel()::labelFormat = ' + labelFormat);

                var dateStr = getCurrentDateForFilename();
                var extension = labelFormat === 'ZPL' ? '.zpl' : (labelFormat === 'GIF' ? '.gif' : '.png');
                var fileName = dateStr + '_' + salesOrderNumber + '_' + packageSequenceNumber + extension;

                log.debug('DEBUG', 'saveUPSLabel()::fileName = ' + fileName);

                // Get or create UPS labels folder
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
                        contents: decodedZpl,
                        folder: folderId
                    });
                } else {
                    // GIF/PNG are binary - use base64 encoding
                    var fileType = labelFormat === 'GIF' ? file.Type.GIFIMAGE : file.Type.PNGIMAGE;

                    labelFile = file.create({
                        name: fileName,
                        fileType: fileType,
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

                log.debug('Print UPS Labels', 'Printing ' + labelUrls.length + ' labels');

                for (var i = 0; i < labelUrls.length; i++) {
                    try {
                        printNodeLib.printLabel(labelUrls[i]);
                        log.debug('Print UPS Label', 'Printed label: ' + labelUrls[i]);
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
         */
        function updateMultiplePackageTrackingNumbers(fulfillmentId, upsResponse) {
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

                // Load the Item Fulfillment record for updating
                var recordForUpdate = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId
                });

                var packageCount = recordForUpdate.getLineCount({ sublistId: 'package' });
                log.debug('Multiple Tracking Info', 'Package lines in NetSuite: ' + packageCount);

                // Update tracking numbers sequentially
                for (var i = 0; i < Math.min(packageCount, packageResults.length); i++) {
                    var trackingNumber = packageResults[i].TrackingNumber;

                    recordForUpdate.setSublistValue({
                        sublistId: 'package',
                        fieldId: 'packagetrackingnumber',
                        line: i,
                        value: trackingNumber
                    });

                    log.debug('Tracking Update', 'Package ' + (i + 1) + ': ' + trackingNumber);
                }

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

                    packshipRecords.push({
                        id: result.getValue('internalid'),
                        carton: cartonName,
                        cartonRecordId: cartonRecordId,
                        item: itemValue,
                        quantity: parseFloat(quantityValue) || 0
                    });

                    log.debug('PackShip Record', 'ID: ' + result.getValue('internalid') +
                        ', Carton: "' + cartonName + '", Item: ' + itemValue + ', Qty: ' + quantityValue);
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
                    // Get third party billing address from mapping
                    var thirdPartyBillAddrJson = mappingRecord.getValue('custrecord_hyc_ship_lbl_3p_bill_addr');
                    log.debug('DEBUG', 'buildPaymentInformation()::thirdPartyBillAddrJson = ' + thirdPartyBillAddrJson);

                    if (thirdPartyBillAddrJson) {
                        var thirdPartyInfo = JSON.parse(thirdPartyBillAddrJson);

                        log.debug('DEBUG', 'buildPaymentInformation()::IS_TEST_MODE = ' + IS_TEST_MODE);
                        log.debug('DEBUG', 'buildPaymentInformation()::Using BillThirdParty with account: ' + thirdPartyAccountNumber);

                        // In test mode, use WC account; in production, use third party account
                        var billingAccount = IS_TEST_MODE ? wcAccountNumber : thirdPartyAccountNumber;

                        // UPS BillThirdParty structure (ShipmentCharge is an object, not array)
                        return {
                            ShipmentCharge: {
                                Type: '01', // Transportation charges
                                BillThirdParty: {
                                    AccountNumber: billingAccount,
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
                        var cartonData = calculateCartonData(cartonGroups[cartonId]);

                        packages.push({
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
                                Length: String(Math.ceil(cartonData.dimensions.length) || 10),
                                Width: String(Math.ceil(cartonData.dimensions.width) || 10),
                                Height: String(Math.ceil(cartonData.dimensions.height) || 10)
                            },
                            PackageWeight: {
                                UnitOfMeasurement: {
                                    Code: 'LBS',
                                    Description: 'Pounds'
                                },
                                Weight: String(cartonData.weight)
                            }
                        });
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

                        packages.push({
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
                        });
                    }
                }

                // If still no packages, create a default one
                if (packages.length === 0) {
                    packages.push({
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
                    });
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
         * Create UPS Shipment via API
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {boolean} testMode If true, only validates but doesn't save to record
         * @returns {Object} Result with success, trackingNumber, labelData, etc.
         */
        function createShipment(fulfillmentRecord, testMode) {
            var startTime = Date.now();
            log.debug('createShipment', 'Starting shipment creation for fulfillment: ' + fulfillmentRecord.id);

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
                    var result = processShipmentResponse(fulfillmentRecord, response.result, testMode);

                    var executionTime = Date.now() - startTime;
                    log.audit('createShipment Success', 'Shipment created in ' + executionTime + 'ms. Tracking: ' + result.trackingNumber);

                    return {
                        success: true,
                        message: 'UPS shipment created successfully' + (testMode ? ' (Test Mode)' : ''),
                        trackingNumber: result.trackingNumber,
                        labelData: result.labelData,
                        apiResponse: response.result,
                        executionTime: executionTime
                    };
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
        function processShipmentResponse(fulfillmentRecord, apiResponse, testMode) {
            try {
                log.debug('processShipmentResponse', 'Processing UPS shipment response');

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

                // Update fulfillment record if not in test mode
                if (!testMode && trackingNumber) {
                    try {
                        // Update tracking numbers on packages
                        if (packageResults.length > 0) {
                            updateMultiplePackageTrackingNumbers(fulfillmentRecord.id, apiResponse);
                        }

                        // Save labels to file cabinet
                        var tranId = fulfillmentRecord.getValue({ fieldId: 'tranid' }) || 'IF' + fulfillmentRecord.id;
                        for (var j = 0; j < packageResults.length; j++) {
                            if (packageResults[j].LabelData) {
                                saveUPSLabel(
                                    packageResults[j].LabelData,  // base64Data
                                    tranId,                        // salesOrderNumber/tranId for filename
                                    j + 1,                         // packageSequenceNumber
                                    'ZPL'                          // labelFormat
                                );
                            }
                        }

                        log.audit('processShipmentResponse', 'Updated fulfillment with tracking and labels');
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
            buildShipmentPayload: buildShipmentPayload,
            createShipment: createShipment,
            processShipmentResponse: processShipmentResponse,
            saveUPSLabel: saveUPSLabel,
            getUPSLabelFolderId: getUPSLabelFolderId,
            printUPSLabels: printUPSLabels,
            updateMultiplePackageTrackingNumbers: updateMultiplePackageTrackingNumbers
        };
    }
);
