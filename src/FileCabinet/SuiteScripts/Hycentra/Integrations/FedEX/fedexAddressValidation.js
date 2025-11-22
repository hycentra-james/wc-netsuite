 /*
 * fedexAddressValidation.js
 * FedEx Address Validation API functions
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/log', 'N/error', './fedexHelper'],
    function (record, log, error, fedexHelper) {
        
        /**
         * Validate shipping address using FedEx Address Validation API
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} { classification: string, apiResponse: Object } Address classification and API response
         */
        function validateAddress(salesOrderRecord) {
            try {
                log.debug('FedEx Address Validation', 'Validating address for Sales Order: ' + salesOrderRecord.id);
                
                // Build address validation payload
                var payload = buildAddressValidationPayload(salesOrderRecord);
                
                // Get authentication token and API URL
                var tokenRecord = fedexHelper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_access_token' });
                var baseApiUrl = fedexHelper.getApiUrl();
                
                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }
                
                var apiUrl = baseApiUrl + 'address/v1/addresses/resolve';
                
                log.debug('FedEx Address Validation', 'API URL: ' + apiUrl);
                log.debug('FedEx Address Validation', 'Payload: ' + JSON.stringify(payload));
                
                // Make the API call
                var response = fedexHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));
                
                log.debug('FedEx Address Validation', 'Response Status: ' + response.status);
                log.debug('FedEx Address Validation', 'Response: ' + JSON.stringify(response.result));
                
                // Process response and extract classification
                if (response.status === 200 || response.status === 201) {
                    var classification = parseAddressValidationResponse(response.result);
                    log.debug('FedEx Address Validation', 'Extracted classification: ' + classification);
                    return {
                        classification: classification,
                        apiResponse: response.result
                    };
                } else {
                    // Return error response for storage
                    var errorResponse = response.result || {};
                    throw error.create({
                        name: 'FEDEX_ADDRESS_VALIDATION_API_ERROR',
                        message: 'FedEx Address Validation API returned status ' + response.status + ': ' + JSON.stringify(response.result),
                        apiResponse: errorResponse
                    });
                }
                
            } catch (e) {
                log.error({
                    title: 'FedEx Address Validation Error',
                    details: 'Error validating address: ' + e.message + '\nStack: ' + e.stack
                });
                // Include API response in error if available
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
         * @returns {Object} Address validation request payload
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
                
                // Build street lines array (only include non-empty values)
                var streetLines = [];
                if (addr1 && addr1.trim() !== '') {
                    streetLines.push(addr1.trim());
                }
                if (addr2 && addr2.trim() !== '') {
                    streetLines.push(addr2.trim());
                }
                
                // Validate required fields
                if (streetLines.length === 0) {
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
                
                // Build payload matching FedEx API structure
                var payload = {
                    addressesToValidate: [{
                        address: {
                            streetLines: streetLines,
                            countryCode: countryCode
                        }
                    }]
                };
                
                // Add optional fields if available
                if (city && city.trim() !== '') {
                    payload.addressesToValidate[0].address.city = city.trim();
                }
                if (state && state.trim() !== '') {
                    payload.addressesToValidate[0].address.stateOrProvinceCode = state.trim();
                }
                if (zip && zip.trim() !== '') {
                    payload.addressesToValidate[0].address.postalCode = zip.trim();
                }
                
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
         * @param {Object} apiResponse The API response object
         * @returns {string} Classification: "RESIDENTIAL", "BUSINESS", "MIXED", or "UNKNOWN"
         */
        function parseAddressValidationResponse(apiResponse) {
            try {
                log.debug('Parse Address Validation', 'Parsing API response');
                
                // Check if response has output and resolvedAddresses
                if (!apiResponse || !apiResponse.output || !apiResponse.output.resolvedAddresses || 
                    apiResponse.output.resolvedAddresses.length === 0) {
                    log.warning({
                        title: 'Address Validation Parse Warning',
                        details: 'API response does not contain resolved addresses. Response: ' + JSON.stringify(apiResponse)
                    });
                    return 'UNKNOWN';
                }
                
                // Use the first resolved address
                var resolvedAddress = apiResponse.output.resolvedAddresses[0];
                
                // Try to get classification from attributes first
                var classification = null;
                if (resolvedAddress.attributes && resolvedAddress.attributes.classification) {
                    classification = resolvedAddress.attributes.classification;
                } else if (resolvedAddress.classification) {
                    classification = resolvedAddress.classification;
                }
                
                if (classification) {
                    // Normalize to uppercase
                    classification = classification.toUpperCase();
                    log.debug('Parse Address Validation', 'Found classification: ' + classification);
                    return classification;
                } else {
                    log.warning({
                        title: 'Address Validation Parse Warning',
                        details: 'Could not find classification in resolved address. Response: ' + JSON.stringify(resolvedAddress)
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
        
        return {
            validateAddress: validateAddress,
            buildAddressValidationPayload: buildAddressValidationPayload,
            parseAddressValidationResponse: parseAddressValidationResponse
        };
    }
);

