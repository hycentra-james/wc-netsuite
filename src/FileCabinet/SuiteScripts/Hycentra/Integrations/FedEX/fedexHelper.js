/*
 * fedexHelper.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/runtime', 'N/record', 'N/format', 'N/https', 'N/error', 'N/log'],
    function (runtime, record, format, https, error, log) {
        const CONFIG_RECORD_TYPE = 'customrecord_hyc_fedex_config';
        const CONFIG_RECORD_ID = 1; // Configuration record ID for FedEx

        /**
         * Get the FedEx API URL endpoint from the custom preferences
         *
         * @returns {string} The URL string
         */
        function getApiUrl() {
            try {
                // Load the config record directly to avoid circular dependency
                var tokenRecord = record.load({
                    type: CONFIG_RECORD_TYPE,
                    id: CONFIG_RECORD_ID
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
                    id: CONFIG_RECORD_ID
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
                id: CONFIG_RECORD_ID,
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
         * Build FedEx Create Shipment request payload from NetSuite Item Fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} FedEx shipment request payload
         */
        function buildShipmentPayload(fulfillmentRecord) {
            try {
                // Get FedEx account number from configuration
                var tokenRecord = getTokenRecord();
                var accountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_account_number' });

                if (!accountNumber) {
                    throw error.create({
                        name: 'MISSING_ACCOUNT_NUMBER',
                        message: 'FedEx account number not configured in settings'
                    });
                }

                // Build the payload - match FedEx example structure
                var payload = {
                    "labelResponseOptions": "URL_ONLY",
                    "requestedShipment": {
                        "shipper": buildShipperInfo(fulfillmentRecord),
                        "recipients": [buildRecipientInfo(fulfillmentRecord)],
                        "shipDatestamp": getCurrentDateString(),
                        "serviceType": getServiceType(fulfillmentRecord),
                        "packagingType": getPackagingType(fulfillmentRecord),
                        "pickupType": "USE_SCHEDULED_PICKUP",
                        "blockInsightVisibility": false,
                        "shippingChargesPayment": {
                            "paymentType": "SENDER" // SENDER / THIRD_PARTY
                            // The following is for bill to third party:
                            /*
                            "paymentType": "THIRD_PARTY",
                            "payor": {
                                "responsibleParty": {
                                    "address": {
                                        "streetLines": ["7301 W 25th Street", "Unit #114"],
                                        "city": "North Riverside",
                                        "stateOrProvinceCode": "IL",
                                        "postalCode": "60546",
                                        "countryCode": "US",
                                        "residential": false
                                    },
                                    "contact": {
                                        "companyName": "BisonOffice LLC"
                                    },
                                    "accountNumber": {
                                        "value": "671128036"
                                    }
                                }
                            }
                            */
                        },
                        "labelSpecification": {
                            "imageType": "ZPLII",
                            "labelStockType": "STOCK_4X6"
                        },
                        "requestedPackageLineItems": buildPackageLineItems(fulfillmentRecord)
                    },
                    "accountNumber": {
                        "value": accountNumber
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
         * Build shipper information from NetSuite company information
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Object} Shipper information
         */
        function buildShipperInfo(fulfillmentRecord) {
            // Get company information - you may need to adjust these based on your setup
            var companyInfo = runtime.getCurrentUser().getPreference({ name: 'COMPANYNAME' }) || 'Water Creation';

            // TODO: Update these with your actual company information
            return {
                "contact": {
                    "personName": "Shipping Department",
                    "emailAddress": "orders@watercreation.com", // TODO: Update with actual email
                    "phoneNumber": "9097731777", // TODO: Update with actual phone
                    "companyName": companyInfo
                },
                "address": {
                    "streetLines": ["701 Auto Center Dr"], // TODO: Update with actual address
                    "city": "Ontario", // TODO: Update with actual city
                    "stateOrProvinceCode": "CA", // TODO: Update with actual state
                    "postalCode": "91761", // TODO: Update with actual ZIP (now matches CA)
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
             // First try individual fields (legacy approach)
            var shipAddr1 = fulfillmentRecord.getValue({ fieldId: 'shipaddr1' }) || '';
            var shipAddr2 = fulfillmentRecord.getValue({ fieldId: 'shipaddr2' }) || '';
            var shipCity = fulfillmentRecord.getValue({ fieldId: 'shipcity' }) || '';
            var shipState = fulfillmentRecord.getValue({ fieldId: 'shipstate' }) || '';
            var shipZip = fulfillmentRecord.getValue({ fieldId: 'shipzip' }) || '';
            var shipCountry = fulfillmentRecord.getValue({ fieldId: 'shipcountry' }) || 'US';
            var shipPhone = fulfillmentRecord.getValue({ fieldId: 'shipphone' }) || '';

            // If individual fields are populated, use them
            if (shipAddr1 && shipCity && shipState) {
                var recipientName = fulfillmentRecord.getText({ fieldId: 'entity' }) || 'Customer';
                var streetLines = [shipAddr1];
                if (shipAddr2) {
                    streetLines.push(shipAddr2);
                }

                return {
                    "contact": {
                        "personName": recipientName,
                        "phoneNumber": shipPhone
                    },
                    "address": {
                        "streetLines": streetLines,
                        "city": shipCity,
                        "stateOrProvinceCode": shipState,
                        "postalCode": shipZip,
                        "countryCode": shipCountry
                    }
                };
            }

            // Primary approach: Parse NetSuite formatted address string
            // NetSuite address fields return formatted strings with newline separators
            var formattedAddress = fulfillmentRecord.getValue({ fieldId: 'shipaddress' });
            if (formattedAddress) {
                log.debug('DEBUG', 'Using formatted address string from shipaddress field');
                log.debug('DEBUG', 'Address type: ' + (typeof formattedAddress));
                log.debug('DEBUG', 'Raw address data: ' + JSON.stringify(formattedAddress));

                // Parse the formatted address string
                return parseFormattedAddress(formattedAddress, shipCountry);
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
         * Build customer references from Item Fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Array} Array of customer references
         */
        function buildCustomerReferences(fulfillmentRecord) {
            var references = [];

            // Reference 1 - Generic custom field or SO number
            var reference1 = fulfillmentRecord.getValue({ fieldId: 'custbody_shipping_reference1' }) ||
                fulfillmentRecord.getValue({ fieldId: 'tranid' }) || '';

            if (reference1) {
                references.push({
                    "customerReferenceType": "CUSTOMER_REFERENCE",
                    "value": reference1.toString().substring(0, 30) // FedEx has 30 char limit
                });
            }

            // Reference 2 - Generic custom field or Customer PO
            var reference2 = fulfillmentRecord.getValue({ fieldId: 'custbody_shipping_reference2' }) ||
                fulfillmentRecord.getValue({ fieldId: 'otherrefnum' }) || '';

            if (reference2) {
                references.push({
                    "customerReferenceType": "P_O_NUMBER",
                    "value": reference2.toString().substring(0, 30)
                });
            }

            return references;
        }

        /**
         * Build package line items from Item Fulfillment
         *
         * @param {record} fulfillmentRecord The Item Fulfillment record
         * @returns {Array} Array of package line items
         */
        function buildPackageLineItems(fulfillmentRecord) {
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
            var references = buildCustomerReferences(fulfillmentRecord);
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
            var shipMethod = fulfillmentRecord.getText({ fieldId: 'shipmethod' }) || '';

            // Map your shipping methods to FedEx service types
            if (shipMethod.toLowerCase().indexOf('overnight') !== -1) {
                return 'FEDEX_PRIORITY_OVERNIGHT';
            } else if (shipMethod.toLowerCase().indexOf('ground') !== -1) {
                return 'FEDEX_GROUND';
            } else if (shipMethod.toLowerCase().indexOf('2day') !== -1) {
                return 'FEDEX_2_DAY';
            }

            // Default service
            return 'FEDEX_GROUND';
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
            getCurrentDateString: getCurrentDateString
        };
    }
); 