/*
 * upsAddressValidation.js
 * UPS Address Validation API functions
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/log', 'N/error', './upsHelper'],
    function (record, log, error, upsHelper) {

        /**
         * Validate shipping address using UPS Address Validation API
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} { classification: string, apiResponse: Object } Address classification and API response
         */
        function validateAddress(salesOrderRecord) {
            try {
                log.debug('UPS Address Validation', 'Validating address for Sales Order: ' + salesOrderRecord.id);

                // Build address validation payload
                var payload = buildAddressValidationPayload(salesOrderRecord);

                // Get authentication token and API URL
                var tokenRecord = upsHelper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_ups_access_token' });
                var baseApiUrl = upsHelper.getApiUrl();

                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }

                // UPS Address Validation endpoint (v2)
                // The "3" at the end indicates: 1=validation only, 2=classification only, 3=both
                var apiUrl = baseApiUrl + 'api/addressvalidation/v2/3';

                log.debug('UPS Address Validation', 'API URL: ' + apiUrl);
                log.debug('UPS Address Validation', 'Payload: ' + JSON.stringify(payload));

                // Make the API call
                var response = upsHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));

                log.debug('UPS Address Validation', 'Response Status: ' + response.status);
                log.debug('UPS Address Validation', 'Response: ' + JSON.stringify(response.result));

                // Process response and extract classification
                if (response.status === 200 || response.status === 201) {
                    var classification = parseAddressValidationResponse(response.result);
                    log.debug('UPS Address Validation', 'Extracted classification: ' + classification);
                    return {
                        classification: classification,
                        apiResponse: response.result
                    };
                } else {
                    var errorResponse = response.result || {};
                    throw error.create({
                        name: 'UPS_ADDRESS_VALIDATION_API_ERROR',
                        message: 'UPS Address Validation API returned status ' + response.status + ': ' + JSON.stringify(response.result),
                        apiResponse: errorResponse
                    });
                }

            } catch (e) {
                log.error({
                    title: 'UPS Address Validation Error',
                    details: 'Error validating address: ' + e.message + '\nStack: ' + e.stack
                });
                if (e.apiResponse) {
                    e.apiResponse = e.apiResponse;
                }
                throw e;
            }
        }

        /**
         * Build address validation payload from Sales Order shipping address
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} Address validation request payload in UPS format
         */
        function buildAddressValidationPayload(salesOrderRecord) {
            try {
                log.debug('Address Validation Payload', 'Building payload for Sales Order: ' + salesOrderRecord.id);

                // Get shipping address subrecord
                var shippingAddressSubrecord = salesOrderRecord.getSubrecord({ fieldId: 'shippingaddress' });
                if (!shippingAddressSubrecord) {
                    throw error.create({
                        name: 'MISSING_SHIPPING_ADDRESS',
                        message: 'Sales Order ' + salesOrderRecord.id + ' does not have a shipping address'
                    });
                }

                // Extract address fields
                var addr1 = shippingAddressSubrecord.getValue({ fieldId: 'addr1' }) || '';
                var addr2 = shippingAddressSubrecord.getValue({ fieldId: 'addr2' }) || '';
                var city = shippingAddressSubrecord.getValue({ fieldId: 'city' }) || '';
                var state = shippingAddressSubrecord.getValue({ fieldId: 'state' }) || '';
                var zip = shippingAddressSubrecord.getValue({ fieldId: 'zip' }) || '';
                var countryId = shippingAddressSubrecord.getValue({ fieldId: 'country' });

                // Convert country ID to country code
                var countryCode = 'US'; // Default
                if (countryId) {
                    try {
                        var countryRecord = record.load({ type: 'country', id: countryId });
                        countryCode = countryRecord.getValue({ fieldId: 'countrycode' }) || 'US';
                    } catch (countryError) {
                        log.debug('Country Lookup Warning', 'Could not load country ID: ' + countryId + ', using default US');
                    }
                }

                // Build address lines array
                var addressLines = [];
                if (addr1 && addr1.trim() !== '') {
                    addressLines.push(addr1.trim());
                }
                if (addr2 && addr2.trim() !== '') {
                    addressLines.push(addr2.trim());
                }

                // Validate required fields
                if (addressLines.length === 0) {
                    throw error.create({
                        name: 'INVALID_ADDRESS',
                        message: 'Sales Order ' + salesOrderRecord.id + ' shipping address is missing street address'
                    });
                }

                if (!countryCode) {
                    throw error.create({
                        name: 'INVALID_ADDRESS',
                        message: 'Sales Order ' + salesOrderRecord.id + ' shipping address is missing country code'
                    });
                }

                // Build UPS Address Validation payload
                // UPS XAVRequest format
                var payload = {
                    XAVRequest: {
                        AddressKeyFormat: {
                            AddressLine: addressLines,
                            PoliticalDivision2: city.trim(), // City
                            PoliticalDivision1: state.trim(), // State
                            PostcodePrimaryLow: zip.trim(), // ZIP Code
                            CountryCode: countryCode
                        }
                    }
                };

                log.debug('Address Validation Payload', 'Payload built successfully');
                return payload;

            } catch (e) {
                log.error({
                    title: 'Address Validation Payload Error',
                    details: 'Error building address validation payload: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }

        /**
         * Parse address validation response to extract classification
         *
         * UPS Address Classification Codes:
         * - "0" = Unknown
         * - "1" = Commercial
         * - "2" = Residential
         *
         * @param {Object} apiResponse The API response object
         * @returns {string} Classification: "RESIDENTIAL", "BUSINESS", or "UNKNOWN"
         */
        function parseAddressValidationResponse(apiResponse) {
            try {
                log.debug('Parse Address Validation', 'Parsing API response');

                // UPS response structure:
                // XAVResponse.Candidate[].AddressClassification.Code
                // or XAVResponse.AddressClassification.Code for single result

                if (!apiResponse || !apiResponse.XAVResponse) {
                    log.audit({
                        title: 'Address Validation Parse Warning',
                        details: 'API response does not contain XAVResponse. Response: ' + JSON.stringify(apiResponse)
                    });
                    return 'UNKNOWN';
                }

                var xavResponse = apiResponse.XAVResponse;

                // Check for classification in different response structures
                var classificationCode = null;

                // Try to get from Candidate array (multiple results)
                if (xavResponse.Candidate) {
                    var candidates = Array.isArray(xavResponse.Candidate) ? xavResponse.Candidate : [xavResponse.Candidate];
                    if (candidates.length > 0 && candidates[0].AddressClassification) {
                        classificationCode = candidates[0].AddressClassification.Code;
                    }
                }

                // Try to get from direct AddressClassification
                if (!classificationCode && xavResponse.AddressClassification) {
                    classificationCode = xavResponse.AddressClassification.Code;
                }

                // Try to get from ValidAddressIndicator (some responses)
                if (!classificationCode && xavResponse.ValidAddressIndicator) {
                    // If valid address indicator is present, check for residential
                    if (xavResponse.ResidentialAddressIndicator) {
                        classificationCode = '2'; // Residential
                    } else {
                        classificationCode = '1'; // Commercial
                    }
                }

                if (classificationCode) {
                    // Map UPS codes to standard classification
                    // "0" = Unknown, "1" = Commercial, "2" = Residential
                    var classification = mapUPSClassificationCode(classificationCode);
                    log.debug('Parse Address Validation', 'Found classification code: ' + classificationCode + ' -> ' + classification);
                    return classification;
                } else {
                    log.audit({
                        title: 'Address Validation Parse Warning',
                        details: 'Could not find classification in response. Response: ' + JSON.stringify(xavResponse)
                    });
                    return 'UNKNOWN';
                }

            } catch (e) {
                log.error({
                    title: 'Parse Address Validation Error',
                    details: 'Error parsing address validation response: ' + e.message + '\nStack: ' + e.stack
                });
                return 'UNKNOWN';
            }
        }

        /**
         * Map UPS classification code to standard classification string
         *
         * @param {string} upsCode The UPS classification code ("0", "1", or "2")
         * @returns {string} Standard classification: "RESIDENTIAL", "BUSINESS", or "UNKNOWN"
         */
        function mapUPSClassificationCode(upsCode) {
            switch (upsCode) {
                case '1':
                    return 'BUSINESS';
                case '2':
                    return 'RESIDENTIAL';
                case '0':
                default:
                    return 'UNKNOWN';
            }
        }

        return {
            validateAddress: validateAddress,
            buildAddressValidationPayload: buildAddressValidationPayload,
            parseAddressValidationResponse: parseAddressValidationResponse,
            mapUPSClassificationCode: mapUPSClassificationCode
        };
    }
);
