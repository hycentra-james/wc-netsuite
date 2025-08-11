/*
 * fedexHelper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/runtime', 'N/record', 'N/format', 'N/https', 'N/error', 'N/log', 'N/file', 'N/search'],
    function (runtime, record, format, https, error, log, file, search) {
        const CONFIG_RECORD_TYPE = 'customrecord_hyc_fedex_config';
        const SANDBOX_CONFIG_RECORD_ID = 1; // TODO: Change this Record ID after production for FedEx
        const PRODUCTION_CONFIG_RECORD_ID = 2; // TODO: Change this Record ID after production for FedEx
        
        // Module-level variable to store test mode flag
        var IS_TEST_MODE = false;

        /**
         * Get the current config record ID based on test mode
         *
         * @returns {number} Config record ID
         */
        function getCurrentConfigRecordId() {
            return IS_TEST_MODE ? SANDBOX_CONFIG_RECORD_ID : PRODUCTION_CONFIG_RECORD_ID;
        }

        /**
         * Get the FedEx API URL endpoint from the custom preferences
         *
         * @returns {string} The URL string
         */
        function getApiUrl() {
            try {
                // Get config record ID based on current test mode
                var configRecordId = getCurrentConfigRecordId();
                log.debug('DEBUG', 'getApiUrl()::IS_TEST_MODE = ' + IS_TEST_MODE + ', using config record ID = ' + configRecordId);
                
                // Load the config record directly to avoid circular dependency
                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: configRecordId
                });

                if (!tokenRecord.isEmpty) {
                    var endpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_endpoint' });
                    // Ensure endpoint ends with trailing slash
                    if (endpoint && !endpoint.endsWith('/')) {
                        endpoint = endpoint + '/';
                        log.debug('DEBUG', 'Added trailing slash to endpoint: ' + endpoint);
                    }
                    return endpoint || "https://apis.fedex.com/";
                } else {
                    return "https://apis.fedex.com/"; // Production endpoint
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error getting API URL, using default: ' + e.message
                });
                return "https://apis.fedex.com/"; // Fallback to production
            }
        }

        /**
         * Get the FedEx API configuration record
         *
         * @returns {record} The FedEx configuration token record
         */
        function getTokenRecord() {
            log.debug('DEBUG', 'getTokenRecord()::start');
            try {
                // Load the Token from configuration
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
                    details: 'Error loading FedEx configuration record: ' + e.message
                });
                throw e;
            }
        }

        /**
         * Validate if the current token is still valid or needs refresh
         *
         * @param {record} tokenRecord The FedEx configuration record
         * @returns {record} Updated token record
         */
        function validateToken(tokenRecord) {
            try {
                var expirationValue = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_expiration' });

                // Check if expiration value exists
                if (!expirationValue) {
                    log.debug('DEBUG', 'No expiration date found, refreshing token');
                    tokenRecord = refreshToken(tokenRecord);
                    return tokenRecord;
                }

                var expirationDateObj = format.parse({
                    value: expirationValue,
                    type: format.Type.DATETIMETZ
                });

                // Get the current date and time
                var nowDateObj = new Date();

                // Check if the token is expired yet
                if (expirationDateObj > nowDateObj) {
                    log.debug('DEBUG', 'FedEx token is still valid');
                } else {
                    // Refresh the token
                    log.debug('DEBUG', 'FedEx token expired, renewing...');
                    tokenRecord = refreshToken(tokenRecord);
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error validating FedEx token: ' + e.message
                });
                // If no expiration date exists or parsing fails, refresh the token
                log.debug('DEBUG', 'Token validation failed, refreshing token');
                tokenRecord = refreshToken(tokenRecord);
            }

            return tokenRecord;
        }

        /**
         * Refresh the FedEx OAuth token
         *
         * @param {record} tokenRecord The FedEx configuration record
         * @returns {record} Updated token record
         */
        function refreshToken(tokenRecord) {
            // Get the properly formatted endpoint URL (with trailing slash)
            var baseUrl = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_endpoint' }) || "https://apis.fedex.com/";

            // Ensure endpoint ends with trailing slash
            if (!baseUrl.endsWith('/')) {
                baseUrl = baseUrl + '/';
                log.debug('DEBUG', 'Added trailing slash to endpoint: ' + baseUrl);
            }

            var apiUrl = baseUrl + "oauth/token";
            var clientId = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_client_id' });
            var clientSecret = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_secret' });
            var grantType = 'client_credentials';

            // Set up the request payload
            var payload = 'grant_type=' + grantType + '&client_id=' + clientId + '&client_secret=' + clientSecret;

            log.debug('DEBUG', 'refreshToken()::apiUrl = ' + apiUrl);

            try {
                // Make the HTTP POST request to obtain the bearer token
                var response = https.post({
                    url: apiUrl,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: payload
                });

                // Check the response status
                if (response.code === 200) {
                    var responseBody = JSON.parse(response.body);
                    var accessToken = responseBody.access_token;
                    var expiresIn = responseBody.expires_in; // FedEx tokens expire in 3600 seconds (1 hour)

                    log.debug('DEBUG', 'refreshToken()::accessToken = ' + accessToken.substring(0, 20) + '...');
                    log.debug('DEBUG', 'refreshToken()::expiresIn = ' + expiresIn);

                    // Update the access token
                    updateAccessToken(accessToken, expiresIn);
                    log.debug('DEBUG', 'refreshToken()::updateAccessToken success');

                    return getTokenRecord();
                } else {
                    log.error('DEBUG', 'FedEx OAuth HTTP Status Code: ' + response.code);
                    log.error('DEBUG', 'FedEx OAuth Error Message: ' + response.body);
                    throw error.create({
                        name: 'FEDEX_AUTH_FAILED',
                        message: 'Failed to refresh FedEx OAuth token. Status: ' + response.code + ', Message: ' + response.body
                    });
                }
            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error refreshing FedEx token: ' + e.message
                });
                throw e;
            }

            // Return the input token if token didn't refresh
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
            var bufferSeconds = 300; // 5 minutes buffer
            var expirationTimestamp = new Date().getTime() + ((expiresIn - bufferSeconds) * 1000);

            log.debug('DEBUG', 'updateAccessToken()::expirationTimestamp = ' + expirationTimestamp);

            // Update the record with the new access token and expiration value
            record.submitFields({
                type: CONFIG_RECORD_TYPE,
                id: getCurrentConfigRecordId(),
                values: {
                    'custrecord_hyc_fedex_access_token': newAccessToken,
                    'custrecord_hyc_fedex_expiration': new Date(expirationTimestamp)
                }
            });

            log.debug('DEBUG', 'updateAccessToken() success');
        }

        /**
         * POST call to the FedEx API
         *
         * @param {string} token Bearer token for authentication
         * @param {string} url The URL at which to make the POST request
         * @param {string} json The JSON string to post
         * @returns {Object} The API response, containing status and result
         */
        function postToApi(token, url, json) {
            var retries = 3;
            var success = false;
            var response;

            while (retries > 0 && success === false) {
                try {
                    response = https.post({
                        url: url,
                        body: json,
                        headers: {
                            'Authorization': 'Bearer ' + token,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'X-locale': 'en_US'
                        }
                    });
                    success = true;
                } catch (e) {
                    retries--;
                    log.error('ERROR', 'FedEx API POST attempt failed: ' + e.message);
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

            log.debug('DEBUG', 'FedEx API success = ' + success);
            log.debug('DEBUG', 'FedEx API response.code = ' + response.code);
            log.debug('DEBUG', 'FedEx API response.body = ' + response.body);

            var result = response.body;

            // Try to parse the result into JSON
            try {
                result = JSON.parse(result);
            } catch (e) {
                log.debug('DEBUG', 'FedEx API response.body is not JSON formatted string');
            }

            var ret = {
                status: response.code,
                result: result
            };

            if (!ret.result || ret.status >= 400) {
                throw error.create({
                    name: 'FEDEX_API_POST_FAILED',
                    message: 'Error posting data to FedEx API endpoint ' + url + '. API responded with status ' + ret.status +
                        '. API response: ' + JSON.stringify(ret.result)
                });
            }

            return ret;
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
                    // Search for matching Shipping Label Mapping record
                    var mappingSearch = search.create({
                        type: 'customrecord_hyc_shipping_label_mapping',
                        filters: [
                            ['custrecord_hyc_ship_lbl_map_customer', search.Operator.ANYOF, customerId],
                            'AND',
                            ['custrecord_hyc_ship_lbl_map_ship_method', search.Operator.ANYOF, shipMethodId]
                        ],
                        columns: [
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
                        log.debug('DEBUG', 'getShippingLabelMapping()::Found mapping record');
                        return searchResults[0];
                    } else {
                        log.debug('DEBUG', 'getShippingLabelMapping()::No matching mapping record found, using fallback record ID 10');
                    }
                } else {
                    log.debug('DEBUG', 'getShippingLabelMapping()::Missing customerId or shipMethodId, using fallback record ID 10');
                }

                // Fallback to record ID 10
                var fallbackRecord = record.load({
                    type: 'customrecord_hyc_shipping_label_mapping',
                    id: 10
                });

                // Convert to search result format for consistency
                return {
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
         * Build shipping charges payment section
         *
         * @param {boolean} isBillToThirdParty Whether to bill to third party
         * @param {Object} mappingRecord The shipping label mapping record
         * @param {string} accountNumber The account number for third party billing
         * @param {string} wcAccountNumber Water Creation account number for test mode
         * @returns {Object} Shipping charges payment section
         */
        function buildShippingChargesPayment(isBillToThirdParty, mappingRecord, billingAccountNumber) {
            try {
                if (isBillToThirdParty && mappingRecord) {
                    // Get third party billing address from mapping
                    var thirdPartyBillAddrJson = mappingRecord.getValue('custrecord_hyc_ship_lbl_3p_bill_addr');
                    log.debug('DEBUG', 'buildShippingChargesPayment()::thirdPartyBillAddrJson = ' + thirdPartyBillAddrJson);
                    
                    if (thirdPartyBillAddrJson) {
                        var thirdPartyInfo = JSON.parse(thirdPartyBillAddrJson);
                        
                        log.debug('DEBUG', 'buildShippingChargesPayment()::IS_TEST_MODE = ' + IS_TEST_MODE);
                        log.debug('DEBUG', 'buildShippingChargesPayment()::billingAccountNumber = ' + billingAccountNumber);
                        
                        return {
                            "paymentType": "THIRD_PARTY",
                            "payor": {
                                "responsibleParty": {
                                    "contact": thirdPartyInfo.contact,
                                    "address": thirdPartyInfo.address,
                                    "accountNumber": {
                                        "value": billingAccountNumber
                                    }
                                }
                            }
                        };
                    }
                }
                
                // Fallback to SENDER payment type
                log.debug('DEBUG', 'buildShippingChargesPayment()::Using SENDER payment type');
                return {
                    "paymentType": "SENDER"
                };
                
            } catch (e) {
                log.error('ERROR', 'Failed to build shipping charges payment: ' + e.message);
                // Fallback to SENDER on error
                return {
                    "paymentType": "SENDER"
                };
            }
        }

        /**
         * Build FedEx Create Shipment request payload from NetSuite Item Fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} FedEx shipment request payload
         */
        function buildShipmentPayload(fulfillmentRecord) {
            try {
                var isBillToThirdParty = false;
                // Get shipping label mapping record once
                var mappingRecord = getShippingLabelMapping(fulfillmentRecord);

                // Get account number from mapping or fallback to config
                var wcAccountNumber = getTokenRecord().getValue({ fieldId: 'custrecord_hyc_fedex_account_number' });
                var accountNumber = null;

                // TODO: This account number will be used for third party billing later.
                if (mappingRecord) {
                    accountNumber = mappingRecord.getValue('custrecord_hyc_ship_lbl_account_no');
                    isBillToThirdParty = true;
                }

                if (isBillToThirdParty && !accountNumber) {
                    throw error.create({
                        name: 'MISSING_THIRD_PARTY_ACCOUNT_NUMBER',
                        message: 'FedEx account number not configured in settings or mapping for third party billing'
                    });
                }
                
                // Use wcAccountNumber in test mode, otherwise use accountNumber
                var billingAccountNumber = IS_TEST_MODE ? wcAccountNumber : accountNumber;

                // Build the payload - match FedEx example structure
                var payload = {
                    "labelResponseOptions": "URL_ONLY",
                    "requestedShipment": {
                        "shipper": buildShipperInfo(fulfillmentRecord, mappingRecord),
                        "recipients": [buildRecipientInfo(fulfillmentRecord)],
                        "shipDatestamp": getCurrentDateString(),
                        "serviceType": getServiceType(fulfillmentRecord),
                        "packagingType": getPackagingType(fulfillmentRecord),
                        "pickupType": "USE_SCHEDULED_PICKUP",
                        "blockInsightVisibility": false,
                        "shippingChargesPayment": buildShippingChargesPayment(isBillToThirdParty, mappingRecord, billingAccountNumber),
                        "labelSpecification": {
                            "imageType": "ZPLII",
                            "labelStockType": "STOCK_4X6"
                        },
                        "requestedPackageLineItems": buildPackageLineItems(fulfillmentRecord, mappingRecord)
                    },
                    "accountNumber": {
                        "value": wcAccountNumber  // TODO: Fix this with the Bill to Third Party Account ?
                    }
                };

                log.debug('DEBUG', 'FedEx payload built successfully');
                return payload;

            } catch (e) {
                log.error({
                    title: 'ERROR',
                    details: 'Error building FedEx shipment payload: ' + e.message
                });
                throw e;
            }
        }

        /**
         * Build shipper information from Shipping Label Mapping
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} mappingRecord The shipping label mapping record
         * @returns {Object} Shipper information
         */
        function buildShipperInfo(fulfillmentRecord, mappingRecord) {
            try {
                if (mappingRecord) {
                    var shipFromJson = mappingRecord.getValue('custrecord_hyc_ship_lbl_ship_from');
                    log.debug('DEBUG', 'buildShipperInfo()::shipFromJson = ' + shipFromJson);

                    if (shipFromJson) {
                        var shipperInfo = JSON.parse(shipFromJson);
                        log.debug('DEBUG', 'buildShipperInfo()::Using custom shipper info from mapping');
                        return shipperInfo;
                    }
                }

            } catch (e) {
                log.error('ERROR', 'Failed to get shipper info from mapping: ' + e.message);
            }

            // Final fallback to hardcoded values if everything fails
            log.debug('DEBUG', 'buildShipperInfo()::Using hardcoded fallback shipper info');
            var companyInfo = runtime.getCurrentUser().getPreference({ name: 'COMPANYNAME' }) || 'Water Creation';

            return {
                "contact": {
                    "personName": "Shipping Department",
                    "emailAddress": "orders@watercreation.com",
                    "phoneNumber": "9097731777",
                    "companyName": companyInfo
                },
                "address": {
                    "streetLines": ["701 Auto Center Dr"],
                    "city": "Ontario",
                    "stateOrProvinceCode": "CA",
                    "postalCode": "91761",
                    "countryCode": "US"
                }
            };
        }

        /**
         * Build recipient information from Item Fulfillment shipping address
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} Recipient information
         */
        function buildRecipientInfo(fulfillmentRecord) {
            // Primary approach: Extract address from Sales Order JSON payload
            try {
                var salesOrderId = fulfillmentRecord.getValue({ fieldId: 'createdfrom' });
                if (salesOrderId) {
                    log.debug('DEBUG', 'buildRecipientInfo()::salesOrderId = ' + salesOrderId);

                    var salesOrderRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: salesOrderId
                    });

                    var jsonPayload = salesOrderRecord.getValue({ fieldId: 'custbody_lb_sourced_data' });
                    if (jsonPayload) {
                        log.debug('DEBUG', 'buildRecipientInfo()::jsonPayload = ' + jsonPayload);

                        var parsedData = JSON.parse(jsonPayload);
                        if (parsedData && parsedData.packSlipFields && parsedData.packSlipFields.ShipTo) {
                            var shipTo = parsedData.packSlipFields.ShipTo;

                            var streetLines = [];
                            if (shipTo.Address1) streetLines.push(shipTo.Address1);
                            if (shipTo.Address2) streetLines.push(shipTo.Address2);

                            return {
                                "contact": {
                                    "personName": shipTo.CompanyName || 'Customer',
                                    "phoneNumber": shipTo.Phone || '9097731777'
                                },
                                "address": {
                                    "streetLines": streetLines.length > 0 ? streetLines : ["Address Not Available"],
                                    "city": shipTo.City || 'Unknown',
                                    "stateOrProvinceCode": shipTo.State || 'XX',
                                    "postalCode": shipTo.Zip || '00000',
                                    "countryCode": shipTo.Country || 'US',
                                    "residential": fulfillmentRecord.getValue({ fieldId: 'shipisresidential' })
                                }
                            };
                        }
                    }
                }
            } catch (e) {
                log.error('ERROR', 'Failed to extract address from Sales Order JSON: ' + e.message);
            }

            // Final fallback: Use customer information
            log.debug('DEBUG', 'Using customer fallback for recipient address');
            return {
                "contact": {
                    "personName": fulfillmentRecord.getText({ fieldId: 'entity' }) || 'Customer',
                    "phoneNumber": ""
                },
                "address": {
                    "streetLines": ["Address Not Available"],
                    "city": "Unknown",
                    "stateOrProvinceCode": "XX",
                    "postalCode": "00000",
                    "countryCode": "US"
                }
            };
        }

        /**
         * Parse formatted address block into FedEx-compatible format
         *
         * @param {string} formattedAddress The formatted address block
         * @param {string} countryCode Country code (default: US)
         * @returns {Object} Parsed recipient information
         */
        function parseFormattedAddress(formattedAddress, countryCode) {
            try {
                // Split address into lines
                var lines = formattedAddress.split('\n').map(function (line) {
                    return line.trim();
                }).filter(function (line) {
                    return line.length > 0;
                });

                if (lines.length < 3) {
                    throw error.create({
                        name: 'INVALID_ADDRESS_FORMAT',
                        message: 'Address must have at least 3 lines: name, street, city/state'
                    });
                }

                log.debug('DEBUG', 'Parsing address lines: ' + JSON.stringify(lines));

                // First line is recipient name (limit to 35 characters for FedEx)
                var recipientName = lines[0].substring(0, 35);

                // Last line is usually phone number (if it's all digits)
                var phoneNumber = '';
                var lastLine = lines[lines.length - 1];
                if (/^\d{10,}$/.test(lastLine.replace(/\D/g, ''))) {
                    phoneNumber = lastLine.replace(/\D/g, '').substring(0, 10);
                    lines.pop(); // Remove phone from address lines
                }

                // Second to last line is usually ZIP code
                var postalCode = '';
                var zipLine = lines[lines.length - 1];
                if (/^\d{5}(-\d{4})?$/.test(zipLine)) {
                    postalCode = zipLine;
                    lines.pop(); // Remove ZIP from address lines
                }

                // Next line should be City, State or City State ZIP
                var city = '';
                var stateCode = '';
                if (lines.length > 1) {
                    var cityStateLine = lines[lines.length - 1];

                    // Try to match "City, ST" format
                    var cityStateMatch = cityStateLine.match(/^(.+),\s*([A-Z]{2})$/);
                    if (cityStateMatch) {
                        city = cityStateMatch[1].trim();
                        stateCode = cityStateMatch[2].trim();
                        lines.pop(); // Remove city/state from address lines
                    } else {
                        // Try to match "City ST ZIP" format (in case ZIP wasn't parsed separately)
                        var cityStateZipMatch = cityStateLine.match(/^(.+)\s+([A-Z]{2})\s+(\d{5}(-\d{4})?)$/);
                        if (cityStateZipMatch) {
                            city = cityStateZipMatch[1].trim();
                            stateCode = cityStateZipMatch[2].trim();
                            if (!postalCode) { // If ZIP wasn't parsed earlier
                                postalCode = cityStateZipMatch[3];
                            }
                            lines.pop(); // Remove city/state/zip from address lines
                        } else {
                            // Last resort: split on space and try to find 2-letter state code
                            var parts = cityStateLine.split(/\s+/);
                            for (var i = parts.length - 1; i >= 0; i--) {
                                if (parts[i].length === 2 && /^[A-Z]{2}$/.test(parts[i])) {
                                    stateCode = parts[i];
                                    city = parts.slice(0, i).join(' ');
                                    break;
                                }
                            }
                            if (!city) {
                                city = cityStateLine; // Use entire line as city
                            }
                            lines.pop();
                        }
                    }
                }

                // Remaining lines are street address
                var streetLines = lines.slice(1); // Skip first line (name)

                // Ensure we have at least one street line
                if (streetLines.length === 0) {
                    streetLines = ['Address Not Provided'];
                }

                // Limit street lines to 35 characters each and max 3 lines for FedEx
                streetLines = streetLines.map(function (line) {
                    return line.substring(0, 35);
                }).slice(0, 3);

                log.debug('DEBUG', 'Parsed address - Name: ' + recipientName + ', City: ' + city + ', State: ' + stateCode + ', ZIP: ' + postalCode + ', Phone: ' + phoneNumber);
                log.debug('DEBUG', 'Street lines: ' + JSON.stringify(streetLines));

                // Validation - ensure minimum required data
                if (!recipientName) {
                    recipientName = 'Customer';
                }
                if (!city) {
                    city = 'Unknown City';
                }
                if (!stateCode) {
                    stateCode = 'XX';
                }
                if (!postalCode) {
                    postalCode = '00000';
                }

                return {
                    "contact": {
                        "personName": recipientName,
                        "phoneNumber": phoneNumber
                    },
                    "address": {
                        "streetLines": streetLines,
                        "city": city,
                        "stateOrProvinceCode": stateCode,
                        "postalCode": postalCode,
                        "countryCode": countryCode || 'US'
                    }
                };

            } catch (e) {
                log.error({
                    title: 'Address Parsing Error',
                    details: 'Error parsing address: ' + formattedAddress + '\nError: ' + e.message
                });

                // Return fallback address structure
                return {
                    "contact": {
                        "personName": "Customer",
                        "phoneNumber": ""
                    },
                    "address": {
                        "streetLines": ["Address Parsing Failed"],
                        "city": "Unknown",
                        "stateOrProvinceCode": "XX",
                        "postalCode": "00000",
                        "countryCode": countryCode || 'US'
                    }
                };
            }
        }

        /**
         * Process reference value with formula support
         *
         * @param {string} referenceValue The reference value (could be formula or hardcoded)
         * @param {record} salesOrderRecord The Sales Order record for formula evaluation
         * @returns {string} Processed reference value
         */
        function processReferenceValue(referenceValue, salesOrderRecord) {
            try {
                if (!referenceValue) {
                    return '';
                }

                // Check if it's a formula (starts and ends with {})
                if (referenceValue.startsWith('{') && referenceValue.endsWith('}')) {
                    // Extract field name from formula
                    var fieldName = referenceValue.substring(1, referenceValue.length - 1);
                    log.debug('DEBUG', 'processReferenceValue()::Processing formula field = ' + fieldName);

                    if (salesOrderRecord) {
                        var fieldValue = salesOrderRecord.getValue({ fieldId: fieldName });
                        log.debug('DEBUG', 'processReferenceValue()::Formula result = ' + fieldValue);
                        return fieldValue || '';
                    } else {
                        log.error('ERROR', 'Sales Order record not available for formula processing');
                        return '';
                    }
                } else {
                    // It's a hardcoded value, return as is
                    log.debug('DEBUG', 'processReferenceValue()::Using hardcoded value = ' + referenceValue);
                    return referenceValue;
                }
            } catch (e) {
                log.error('ERROR', 'Failed to process reference value: ' + e.message);
                return '';
            }
        }

        /**
         * Build customer references from Shipping Label Mapping
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} mappingRecord The shipping label mapping record
         * @returns {Array} Array of customer references
         */
        function buildCustomerReferences(fulfillmentRecord, mappingRecord) {
            var references = [];

            try {
                // Get Sales Order record for formula processing
                var salesOrderRecord = null;
                var salesOrderId = fulfillmentRecord.getValue({ fieldId: 'createdfrom' });
                if (salesOrderId) {
                    salesOrderRecord = record.load({
                        type: record.Type.SALES_ORDER,
                        id: salesOrderId
                    });
                }

                if (mappingRecord) {
                    // Reference 1 from mapping
                    var reference1Value = mappingRecord.getValue('custrecord_hyc_ship_lbl_customer_ref_1');
                    var processedRef1 = processReferenceValue(reference1Value, salesOrderRecord);

                    if (processedRef1) {
                        references.push({
                            "customerReferenceType": "CUSTOMER_REFERENCE",
                            "value": processedRef1.toString().substring(0, 30) // FedEx has 30 char limit
                        });
                    }

                    // Reference 2 from mapping
                    var reference2Value = mappingRecord.getValue('custrecord_hyc_ship_lbl_customer_ref_2');
                    var processedRef2 = processReferenceValue(reference2Value, salesOrderRecord);

                    if (processedRef2) {
                        references.push({
                            "customerReferenceType": "P_O_NUMBER",
                            "value": processedRef2.toString().substring(0, 30)
                        });
                    }

                    // Reference 3 from mapping
                    var reference3Value = mappingRecord.getValue('custrecord_hyc_ship_lbl_customer_ref_3');
                    var processedRef3 = processReferenceValue(reference3Value, salesOrderRecord);

                    if (processedRef3) {
                        references.push({
                            "customerReferenceType": "INVOICE_NUMBER",
                            "value": processedRef3.toString().substring(0, 30)
                        });
                    }
                } else {
                    // Fallback to fulfillment record fields
                    var reference1 = fulfillmentRecord.getValue({ fieldId: 'custbody_shipping_reference1' }) ||
                        fulfillmentRecord.getValue({ fieldId: 'tranid' }) || '';

                    if (reference1) {
                        references.push({
                            "customerReferenceType": "CUSTOMER_REFERENCE",
                            "value": reference1.toString().substring(0, 30)
                        });
                    }

                    var reference2 = fulfillmentRecord.getValue({ fieldId: 'custbody_shipping_reference2' }) ||
                        fulfillmentRecord.getValue({ fieldId: 'otherrefnum' }) || '';

                    if (reference2) {
                        references.push({
                            "customerReferenceType": "P_O_NUMBER",
                            "value": reference2.toString().substring(0, 30)
                        });
                    }

                    var reference3 = fulfillmentRecord.getValue({ fieldId: 'custbody_shipping_reference3' }) || '';

                    if (reference3) {
                        references.push({
                            "customerReferenceType": "INVOICE_NUMBER",
                            "value": reference3.toString().substring(0, 30)
                        });
                    }
                }

            } catch (e) {
                log.error('ERROR', 'Failed to build customer references: ' + e.message);
            }

            return references;
        }

        /**
         * Build package line items from Item Fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {Object} mappingRecord The shipping label mapping record
         * @returns {Array} Array of package line items
         */
        function buildPackageLineItems(fulfillmentRecord, mappingRecord) {
            var packageLineItems = [];
            var itemCount = fulfillmentRecord.getLineCount({ sublistId: 'item' });

            // For simplicity, create one package with total weight
            // You can modify this to create multiple packages if needed
            var totalWeight = 0;

            for (var i = 0; i < itemCount; i++) {
                var quantity = fulfillmentRecord.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: i
                }) || 1;

                // Get item weight (you may need to load item record for weight)
                var itemWeight = 1; // Default weight - modify as needed
                totalWeight += (quantity * itemWeight);
            }

            // Minimum weight of 1 lb
            if (totalWeight < 1) {
                totalWeight = 1;
            }

            // Build the package with customer references at package level
            var packageItem = {
                "weight": {
                    "units": "LB",
                    "value": totalWeight
                },
                "dimensions": {
                    "length": 12,
                    "width": 12,
                    "height": 6,
                    "units": "IN"
                }
            };

            // Add customer references to the package (FedEx requires them at package level)
            var references = buildCustomerReferences(fulfillmentRecord, mappingRecord);
            if (references && references.length > 0) {
                packageItem.customerReferences = references;
            }

            packageLineItems.push(packageItem);

            return packageLineItems;
        }

        /**
         * Get FedEx service type based on shipping method
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {string} FedEx service type
         */
        function getServiceType(fulfillmentRecord) {
            var shipMethodId = fulfillmentRecord.getValue({ fieldId: 'shipmethod' }) || 0;
            var shipMethodText = fulfillmentRecord.getText({ fieldId: 'shipmethod' }) || '';

            log.debug('DEBUG', 'getServiceType()::shipMethod = ' + shipMethodId);
            log.debug('DEBUG', 'getServiceType()::shipMethodText = ' + shipMethodText);

            // Lookup Ship Item record to get display name
            var shipCode = '';
            if (shipMethodId) {
                try {
                    var shipItemRecord = record.load({
                        type: record.Type.SHIP_ITEM,
                        id: shipMethodId
                    });
                    shipCode = shipItemRecord.getValue({ fieldId: 'displayname' }) || '';
                    log.debug('DEBUG', 'getServiceType()::shipCode = ' + shipCode);
                } catch (e) {
                    log.error('ERROR', 'Failed to load ship item record: ' + e.message);
                }
            }

            // See Service List code from FedEX: https://developer.fedex.com/api/en-cr/guides/api-reference.html

            // Default to FEDEX_GROUND if no service is found
            return shipCode || 'FEDEX_GROUND';
        }

        /**
         * Get FedEx packaging type
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {string} FedEx packaging type
         */
        function getPackagingType(fulfillmentRecord) {
            // You can make this dynamic based on your needs
            return 'YOUR_PACKAGING';
        }

        /**
         * Get current date in YYYY-MM-DD format
         *
         * @returns {string} Current date string
         */
        function getCurrentDateString() {
            var tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1); // Use tomorrow to avoid past date validation
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
         * Download FedEx label and save to file cabinet
         *
         * @param {string} labelUrl The URL to download the label from
         * @param {string} bearerToken The bearer token for authentication
         * @param {string} salesOrderNumber The sales order number for filename
         * @returns {string} File URL if successful, original labelUrl if failed
         */
        function downloadAndSaveLabel(labelUrl, bearerToken, salesOrderNumber) {
            try {
                log.debug('DEBUG', 'downloadAndSaveLabel()::labelUrl = ' + labelUrl);
                log.debug('DEBUG', 'downloadAndSaveLabel()::salesOrderNumber = ' + salesOrderNumber);

                // Generate filename
                var dateStr = getCurrentDateForFilename();
                var fileName = dateStr + '_' + salesOrderNumber + '.zpl';

                log.debug('DEBUG', 'downloadAndSaveLabel()::fileName = ' + fileName);

                // Download the label using bearer token
                var response = https.get({
                    url: labelUrl,
                    headers: {
                        'Authorization': 'Bearer ' + bearerToken
                    }
                });

                if (response.code !== 200) {
                    log.error('ERROR', 'Failed to download label, HTTP status: ' + response.code);
                    return labelUrl; // Return original URL on failure
                }

                log.debug('DEBUG', 'Label downloaded successfully, response size: ' + (response.body ? response.body.length : 'unknown'));

                // Create file object
                var fileObj = file.create({
                    name: fileName,
                    fileType: file.Type.PLAINTEXT, // ZPL is text-based
                    contents: response.body,
                    folder: getFedExLabelFolderId() // Get or create the FedEx Label folder
                });

                // Save the file
                var fileId = fileObj.save();
                log.debug('DEBUG', 'Label saved to file cabinet with ID: ' + fileId);

                // Generate the NetSuite file URL
                var fileRecord = file.load({ id: fileId });
                var fileUrl = fileRecord.url;

                log.debug('DEBUG', 'File URL: ' + fileUrl);
                return fileUrl;

            } catch (e) {
                log.error('ERROR', 'Failed to download and save label: ' + e.message);
                return labelUrl; // Return original URL on failure
            }
        }

        /**
         * Get or create the FedEx Label folder ID
         *
         * @returns {number} Folder ID
         */
        function getFedExLabelFolderId() {
            try {
                // Try to find existing folder first
                var folderSearch = search.create({
                    type: search.Type.FOLDER,
                    filters: [
                        ['name', search.Operator.IS, 'FedEx Label']
                    ],
                    columns: ['internalid']
                });

                var searchResults = folderSearch.run().getRange({ start: 0, end: 1 });

                if (searchResults && searchResults.length > 0) {
                    var folderId = searchResults[0].getValue('internalid');
                    log.debug('DEBUG', 'Found existing FedEx Label folder with ID: ' + folderId);
                    return folderId;
                }

                // Create folder if it doesn't exist
                log.debug('DEBUG', 'Creating new FedEx Label folder');
                var folderRecord = record.create({
                    type: record.Type.FOLDER
                });

                folderRecord.setValue({ fieldId: 'name', value: 'FedEx Label' });
                // Set parent to File Cabinet root (leave parent empty for root level)

                var newFolderId = folderRecord.save();
                log.debug('DEBUG', 'Created FedEx Label folder with ID: ' + newFolderId);
                return newFolderId;

            } catch (e) {
                log.error('ERROR', 'Failed to get/create FedEx Label folder: ' + e.message);
                // Return -15 which is typically the SuiteScripts folder ID as fallback
                return -15;
            }
        }

        /**
         * Create FedEx shipment
         * 
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @param {string} serviceTypeOverride Optional service type override
         * @param {boolean} testMode Whether to run in test mode (no record updates)
         * @returns {Object} Shipment creation result
         */
        function createShipment(fulfillmentRecord, serviceTypeOverride, testMode) {
            try {
                // Set the module-level test mode flag
                IS_TEST_MODE = testMode || false;
                log.debug('DEBUG', 'createShipment()::Set IS_TEST_MODE = ' + IS_TEST_MODE);
                
                // Build shipment payload
                var payload = buildShipmentPayload(fulfillmentRecord);

                // Apply service type override if provided
                if (serviceTypeOverride) {
                    payload.requestedShipment.serviceType = serviceTypeOverride;
                }

                // Get API configuration and force token refresh
                var tokenRecord = getTokenRecord();

                // Log current configuration for verification
                var apiKey = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_client_id' });
                var secretKey = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_secret' });
                var accountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_account_number' });
                var endpoint = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_endpoint' });

                log.debug('DEBUG', 'Current Client ID (first 10 chars): ' + (apiKey ? apiKey.substring(0, 10) + '...' : 'EMPTY'));
                log.debug('DEBUG', 'Current Client Secret (first 10 chars): ' + (secretKey ? secretKey.substring(0, 10) + '...' : 'EMPTY'));
                log.debug('DEBUG', 'Current Account Number: ' + accountNumber);
                log.debug('DEBUG', 'Current Endpoint: ' + endpoint);

                // If API key is empty, show error
                if (!apiKey || !secretKey) {
                    throw error.create({
                        name: 'MISSING_CREDENTIALS',
                        message: 'Client ID or Client Secret is empty in NetSuite custom record. Please update the HYC FedEx Configuration record with your new FedEx API credentials.'
                    });
                }

                // Clear any existing token to force fresh authentication
                log.debug('DEBUG', 'Clearing existing token and forcing refresh...');
                tokenRecord.setValue({ fieldId: 'custrecord_hyc_fedex_access_token', value: '' });
                tokenRecord.setValue({ fieldId: 'custrecord_hyc_fedex_expiration', value: '' });
                tokenRecord.save();

                // Force token refresh to ensure new credentials are used
                log.debug('DEBUG', 'Refreshing token with new credentials...');
                var refreshResult = refreshToken(tokenRecord);

                // Get the actual bearer token from the refreshed record
                var bearerToken = '';
                if (refreshResult) {
                    // refreshToken returns the updated record, so get token from it
                    bearerToken = refreshResult.getValue({ fieldId: 'custrecord_hyc_fedex_access_token' }) || '';
                    log.debug('DEBUG', 'Token refresh result: Success - Token: ' + (bearerToken ? bearerToken.substring(0, 20) + '...' : 'No token found in record'));
                } else {
                    log.debug('DEBUG', 'Token refresh result: Failed - no record returned');
                }

                if (!bearerToken) {
                    throw error.create({
                        name: 'TOKEN_REFRESH_FAILED',
                        message: 'Failed to obtain bearer token after refresh'
                    });
                }

                var apiUrl = getApiUrl();
                apiUrl += 'ship/v1/shipments';

                log.audit('FedEx API Call', 'URL: ' + apiUrl);
                log.debug('FedEx Payload', JSON.stringify(payload, null, 2));

                // Enhanced debugging for field validation
                log.debug('FedEx Shipper Details', JSON.stringify(payload.requestedShipment.shipper, null, 2));
                log.debug('FedEx Recipient Details', JSON.stringify(payload.requestedShipment.recipients[0], null, 2));
                log.debug('FedEx Package Details', JSON.stringify(payload.requestedShipment.requestedPackageLineItems[0], null, 2));
                log.debug('FedEx Service Info', 'Service: ' + payload.requestedShipment.serviceType + ', Packaging: ' + payload.requestedShipment.packagingType + ', Pickup: ' + payload.requestedShipment.pickupType);
                log.debug('FedEx Ship Date', 'Date: ' + payload.requestedShipment.shipDatestamp);
                log.debug('FedEx Account Number', 'Account: ' + payload.accountNumber.value);

                // Check for potential validation issues
                var shipper = payload.requestedShipment.shipper;
                var recipient = payload.requestedShipment.recipients[0];
                var package = payload.requestedShipment.requestedPackageLineItems[0];

                // Phone number validation
                if (shipper.contact.phoneNumber) {
                    log.debug('Shipper Phone Validation', 'Phone: "' + shipper.contact.phoneNumber + '", Length: ' + shipper.contact.phoneNumber.length + ', Is Numeric: ' + /^\d+$/.test(shipper.contact.phoneNumber));
                }
                if (recipient.contact.phoneNumber) {
                    log.debug('Recipient Phone Validation', 'Phone: "' + recipient.contact.phoneNumber + '", Length: ' + recipient.contact.phoneNumber.length + ', Is Numeric: ' + /^\d+$/.test(recipient.contact.phoneNumber));
                }

                // Weight/dimension validation
                log.debug('Package Weight Validation', 'Weight: ' + package.weight.value + ' ' + package.weight.units);
                log.debug('Package Dimension Validation', 'Dimensions: ' + package.dimensions.length + 'x' + package.dimensions.width + 'x' + package.dimensions.height + ' ' + package.dimensions.units);

                // Date validation
                var today = new Date();
                var shipDate = new Date(payload.requestedShipment.shipDatestamp);
                log.debug('Date Validation', 'Ship Date: ' + payload.requestedShipment.shipDatestamp + ', Today: ' + today.toISOString().split('T')[0] + ', Valid: ' + (shipDate >= today));

                // Reference validation
                if (package.customerReferences) {
                    for (var r = 0; r < package.customerReferences.length; r++) {
                        var ref = package.customerReferences[r];
                        log.debug('Reference Validation', 'Type: ' + ref.customerReferenceType + ', Value: "' + ref.value + '", Length: ' + ref.value.length);
                    }
                }

                // Make API call
                var response = postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.audit('FedEx Response', 'Status: ' + response.status);
                log.debug('FedEx Response Body', JSON.stringify(response.result, null, 2));

                // Process response
                var trackingNumber = '';
                var labelUrls = [];
                var transactionId = '';
                var alertsJson = '';

                // Get sales order number for filename
                var salesOrderNumber = '';
                try {
                    var salesOrderId = fulfillmentRecord.getValue({ fieldId: 'createdfrom' });
                    if (salesOrderId) {
                        var salesOrderRecord = record.load({
                            type: record.Type.SALES_ORDER,
                            id: salesOrderId
                        });
                        salesOrderNumber = salesOrderRecord.getValue({ fieldId: 'tranid' }) || salesOrderId.toString();
                        log.debug('DEBUG', 'Sales Order Number for filename: ' + salesOrderNumber);
                    }
                } catch (e) {
                    log.error('ERROR', 'Failed to get sales order number: ' + e.message);
                    salesOrderNumber = 'SO' + (new Date().getTime()); // Fallback to timestamp
                }

                if (response.result && response.result.output && response.result.output.transactionShipments) {
                    var shipments = response.result.output.transactionShipments;
                    if (shipments.length > 0) {
                        var firstShipment = shipments[0];

                        // Extract tracking number
                        if (firstShipment.masterTrackingNumber) {
                            trackingNumber = firstShipment.masterTrackingNumber;
                        }

                        // Extract label URLs from all piece responses
                        if (firstShipment.pieceResponses && firstShipment.pieceResponses.length > 0) {
                            for (var i = 0; i < firstShipment.pieceResponses.length; i++) {
                                var pieceResponse = firstShipment.pieceResponses[i];
                                if (pieceResponse.packageDocuments && pieceResponse.packageDocuments.length > 0) {
                                    for (var j = 0; j < pieceResponse.packageDocuments.length; j++) {
                                        var packageDoc = pieceResponse.packageDocuments[j];
                                        if (packageDoc.url && packageDoc.contentType === 'LABEL') {
                                            // Download and save the label, fallback to original URL if download fails
                                            var savedLabelUrl = downloadAndSaveLabel(packageDoc.url, bearerToken, salesOrderNumber);
                                            labelUrls.push(savedLabelUrl);
                                        }
                                    }
                                }
                            }
                        }

                        // Extract alerts for error message field
                        if (firstShipment.alerts && firstShipment.alerts.length > 0) {
                            alertsJson = JSON.stringify(firstShipment.alerts);
                        }
                    }

                    // Extract transaction ID from top level
                    if (response.result.transactionId) {
                        transactionId = response.result.transactionId;
                    }
                }

                // Join multiple label URLs with comma
                var labelUrlString = labelUrls.join(',');

                log.debug('FedEx Response Processing', 'Tracking: ' + trackingNumber +
                    ', Labels: ' + labelUrlString +
                    ', Transaction ID: ' + transactionId +
                    ', Alerts: ' + alertsJson);

                // Update the fulfillment record with results (in test mode, just log)
                if (!testMode) {
                    // For non-test mode, update the actual record with generic fields
                    var updateValues = {
                        custbody_shipping_label_url: labelUrlString,
                        custbody_shipment_transaction_id: transactionId,
                        custbody_shipping_api_response: JSON.stringify(response.result)
                    };

                    // Only add error message if there are alerts
                    if (alertsJson) {
                        updateValues.custbody_shipping_error_message = alertsJson;
                    }

                    record.submitFields({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: fulfillmentRecord.id,
                        values: updateValues
                    });

                    // Update package tracking numbers - need to reload record for packages
                    if (trackingNumber) {
                        var recordForUpdate = record.load({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: fulfillmentRecord.id
                        });

                        var packageCount = recordForUpdate.getLineCount({ sublistId: 'package' });
                        if (packageCount > 0) {
                            recordForUpdate.setSublistValue({
                                sublistId: 'package',
                                fieldId: 'packagetrackingnumber',
                                line: 0,
                                value: trackingNumber
                            });
                            recordForUpdate.save();
                        }
                    }
                } else {
                    // In test mode, just log the values that would be updated
                    log.audit('Test Mode - Would Update Fields', JSON.stringify({
                        custbody_shipping_label_url: labelUrlString,
                        custbody_shipment_transaction_id: transactionId,
                        custbody_shipping_api_response: 'Full API Response (truncated for log)',
                        custbody_shipping_error_message: alertsJson,
                        packagetrackingnumber: trackingNumber
                    }));
                }

                return {
                    success: true,
                    message: 'FedEx shipment created successfully!' + (testMode ? ' (Test Mode)' : ''),
                    trackingNumber: trackingNumber,
                    labelUrl: labelUrlString,
                    transactionId: transactionId,
                    alerts: alertsJson
                };

            } catch (e) {
                log.error({
                    title: 'FedEx Shipment Error',
                    details: e.message + '\nStack: ' + e.stack
                });

                return {
                    success: false,
                    message: e.message
                };
            }
        }

        return {
            getTokenRecord: getTokenRecord,
            validateToken: validateToken,
            refreshToken: refreshToken,
            getApiUrl: getApiUrl,
            postToApi: postToApi,
            buildShipmentPayload: buildShipmentPayload,
            buildShipperInfo: buildShipperInfo,
            buildRecipientInfo: buildRecipientInfo,
            parseFormattedAddress: parseFormattedAddress,
            buildCustomerReferences: buildCustomerReferences,
            buildPackageLineItems: buildPackageLineItems,
            getServiceType: getServiceType,
            getPackagingType: getPackagingType,
            getCurrentDateString: getCurrentDateString,
            createShipment: createShipment
        };
    }
); 