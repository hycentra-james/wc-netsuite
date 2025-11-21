/*
 * fedexRateQuote.js
 * FedEx Rate Quote API functions
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/record', 'N/search', 'N/log', 'N/error', './fedexHelper', './shippingWeightDimension'],
    function (record, search, log, error, fedexHelper, shippingWeightDimension) {
        
        /**
         * Get FedEx rate quote for a Sales Order
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} { rate: number, apiResponse: Object } Shipping rate amount and API response
         */
        function getRateQuote(salesOrderRecord) {
            try {
                var shipMethodId = salesOrderRecord.getValue({ fieldId: 'shipmethod' });

                log.debug('FedEx Rate Quote', 'Getting rate quote for Sales Order: ' + salesOrderRecord.id + ', Ship Method: ' + shipMethodId);

                // Get FedEx service code from mapping
                var fedexServiceCode = fedexHelper.getFedExServiceCode(shipMethodId);
                log.debug('FedEx Rate Quote', 'Using service code: ' + fedexServiceCode);
                
                // Build rate quote payload (pass mappingRecord to avoid reloading)
                var payload = buildRateQuotePayload(salesOrderRecord, fedexServiceCode);
                
                // Get authentication token and API URL
                var tokenRecord = fedexHelper.getTokenRecord();
                var bearerToken = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_access_token' });
                var baseApiUrl = fedexHelper.getApiUrl();
                
                // Ensure baseApiUrl ends with trailing slash
                if (!baseApiUrl.endsWith('/')) {
                    baseApiUrl = baseApiUrl + '/';
                }
                
                var apiUrl = baseApiUrl + 'rate/v1/rates/quotes';
                
                log.debug('FedEx Rate Quote', 'API URL: ' + apiUrl);
                log.debug('FedEx Rate Quote', 'Payload: ' + JSON.stringify(payload));
                
                // Make the API call
                var response = fedexHelper.postToApi(bearerToken, apiUrl, JSON.stringify(payload));
                
                log.debug('FedEx Rate Quote', 'Response Status: ' + response.status);
                log.debug('FedEx Rate Quote', 'Response: ' + JSON.stringify(response.result));
                
                // Process response and extract rate
                if (response.status === 200 || response.status === 201) {
                    var rate = extractRateFromResponse(response.result, fedexServiceCode);
                    log.debug('FedEx Rate Quote', 'Extracted rate: ' + rate);
                    return {
                        rate: rate,
                        apiResponse: response.result
                    };
                } else {
                    // Return error response for storage
                    var errorResponse = response.result || {};
                    throw error.create({
                        name: 'FEDEX_RATE_API_ERROR',
                        message: 'FedEx Rate API returned status ' + response.status + ': ' + JSON.stringify(response.result),
                        apiResponse: errorResponse
                    });
                }
                
            } catch (e) {
                log.error({
                    title: 'FedEx Rate Quote Error',
                    details: 'Error getting FedEx rate quote: ' + e.message + '\nStack: ' + e.stack
                });
                // Include API response in error if available
                if (e.apiResponse) {
                    e.apiResponse = e.apiResponse;
                }
                throw e;
            }
        }
        
        /**
         * Build rate quote payload for FedEx API
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @param {string} fedexServiceCode The FedEx service code (e.g., 'FEDEX_GROUND')
         * @returns {Object} Rate quote request payload
         */
        function buildRateQuotePayload(salesOrderRecord, fedexServiceCode) {
            try {
                log.debug('Rate Quote Payload', 'Building payload for Sales Order: ' + salesOrderRecord.id);
                
                // Get account number
                var tokenRecord = fedexHelper.getTokenRecord();
                var accountNumber = tokenRecord.getValue({ fieldId: 'custrecord_hyc_fedex_account_number' });
                
                // Use provided mappingRecord, or load fallback if not provided
                // Load the Water Creation shipping label mapping record
                var mappingRecord = record.load({
                    type: 'customrecord_hyc_shipping_label_mapping',
                    id: 10 // WC_FEDEX_MAPPING_RECORD_ID
                });
                
                
                // Calculate weight and dimensions
                var weightDimensionData = shippingWeightDimension.calculateSalesOrderWeightAndDimensions(salesOrderRecord);
                
                log.debug('Rate Quote Payload', 'Packages: ' + weightDimensionData.totalPackageCount + ', Total Weight: ' + weightDimensionData.totalWeight + ' lbs');
                
                // Build recipient info from Sales Order shipping address
                var recipientInfo = buildRecipientInfoFromSalesOrder(salesOrderRecord);
                
                // Build shipper info
                var shipperInfo = fedexHelper.buildShipperInfo(null, mappingRecord); // Pass null for fulfillment, use mapping
                
                // Build package line items
                var packageLineItems = [];
                for (var i = 0; i < weightDimensionData.packages.length; i++) {
                    var pkg = weightDimensionData.packages[i];
                    var packageItem = {
                        weight: {
                            value: parseFloat(pkg.weight) || 1, // Convert to number
                            units: 'LB'
                        }
                    };
                    
                    // Add dimensions if available
                    if (pkg.dimensions && pkg.dimensions.length && pkg.dimensions.width && pkg.dimensions.height) {
                        packageItem.dimensions = {
                            length: parseFloat(pkg.dimensions.length) || 1, // Convert to number
                            width: parseFloat(pkg.dimensions.width) || 1, // Convert to number
                            height: parseFloat(pkg.dimensions.height) || 1, // Convert to number
                            units: 'IN'
                        };
                    }
                    
                    packageLineItems.push(packageItem);
                }
                
                // Build full shipper address
                var shipperAddress = {
                    postalCode: shipperInfo.address.postalCode || '91761',
                    countryCode: shipperInfo.address.countryCode || 'US'
                };
                
                // Add street lines if available
                if (shipperInfo.address.streetLines && shipperInfo.address.streetLines.length > 0) {
                    shipperAddress.streetLines = shipperInfo.address.streetLines;
                }
                
                // Add city and state if available
                if (shipperInfo.address.city) {
                    shipperAddress.city = shipperInfo.address.city;
                }
                if (shipperInfo.address.stateOrProvinceCode) {
                    shipperAddress.stateOrProvinceCode = shipperInfo.address.stateOrProvinceCode;
                }
                
                // Add residential flag if available (convert to boolean)
                if (shipperInfo.address.residential !== undefined) {
                    var residentialValue = shipperInfo.address.residential;
                    // Convert NetSuite boolean representation ("T"/"F") or string to boolean
                    if (typeof residentialValue === 'string') {
                        shipperAddress.residential = (residentialValue.toUpperCase() === 'T' || residentialValue.toUpperCase() === 'TRUE');
                    } else {
                        shipperAddress.residential = Boolean(residentialValue);
                    }
                }
                
                // Build full recipient address
                var recipientAddress = {
                    postalCode: recipientInfo.address.postalCode || '00000',
                    countryCode: recipientInfo.address.countryCode || 'US'
                };
                
                // Add street lines if available
                if (recipientInfo.address.streetLines && recipientInfo.address.streetLines.length > 0) {
                    recipientAddress.streetLines = recipientInfo.address.streetLines;
                }
                
                // Add city and state if available
                if (recipientInfo.address.city) {
                    recipientAddress.city = recipientInfo.address.city;
                }
                if (recipientInfo.address.stateOrProvinceCode) {
                    recipientAddress.stateOrProvinceCode = recipientInfo.address.stateOrProvinceCode;
                }
                
                // Add residential flag if available (convert to boolean)
                if (recipientInfo.address.residential !== undefined) {
                    var residentialValue = recipientInfo.address.residential;
                    // Convert NetSuite boolean representation ("T"/"F") or string to boolean
                    if (typeof residentialValue === 'string') {
                        recipientAddress.residential = (residentialValue.toUpperCase() === 'T' || residentialValue.toUpperCase() === 'TRUE');
                    } else {
                        recipientAddress.residential = Boolean(residentialValue);
                    }
                }
                
                // Build payload - matching FedEx Rate API minimal structure
                var payload = {
                    accountNumber: {
                        value: accountNumber
                    },
                    requestedShipment: {
                        shipper: {
                            address: shipperAddress
                        },
                        recipient: {
                            address: recipientAddress
                        },
                        pickupType: 'USE_SCHEDULED_PICKUP',
                        rateRequestType: ['ACCOUNT'],
                        requestedPackageLineItems: packageLineItems
                    }
                };
                
                // Add service type from mapping record (always include if available)
                if (fedexServiceCode) {
                    payload.requestedShipment.serviceType = fedexServiceCode;
                }
                
                log.debug('Rate Quote Payload', 'Payload built successfully');
                return payload;
                
            } catch (e) {
                log.error({
                    title: 'Rate Quote Payload Error',
                    details: 'Error building rate quote payload: ' + e.message + '\nStack: ' + e.stack
                });
                throw e;
            }
        }
        
        /**
         * Build recipient information from Sales Order shipping address
         *
         * @param {record} salesOrderRecord The Sales Order record
         * @returns {Object} Recipient information
         */
        function buildRecipientInfoFromSalesOrder(salesOrderRecord) {
            try {
                log.debug('Recipient Info', 'Building recipient info from Sales Order');
                
                // Try to get shipping address subrecord
                try {
                    var shippingAddressSubrecord = salesOrderRecord.getSubrecord({ fieldId: 'shippingaddress' });
                    if (shippingAddressSubrecord) {
                        var addr1 = shippingAddressSubrecord.getValue({ fieldId: 'addr1' });
                        var addr2 = shippingAddressSubrecord.getValue({ fieldId: 'addr2' });
                        var city = shippingAddressSubrecord.getValue({ fieldId: 'city' });
                        var state = shippingAddressSubrecord.getValue({ fieldId: 'state' });
                        var zip = shippingAddressSubrecord.getValue({ fieldId: 'zip' });
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
                        
                        if (addr1 && city && state && zip) {
                            var streetLines = [addr1];
                            if (addr2) {
                                streetLines.push(addr2);
                            }
                            
                            // Get residential value and convert to boolean
                            var residentialValue = salesOrderRecord.getValue({ fieldId: 'shipisresidential' });
                            var residentialBool = false;
                            if (residentialValue !== undefined && residentialValue !== null && residentialValue !== '') {
                                if (typeof residentialValue === 'string') {
                                    residentialBool = (residentialValue.toUpperCase() === 'T' || residentialValue.toUpperCase() === 'TRUE');
                                } else {
                                    residentialBool = Boolean(residentialValue);
                                }
                            }
                            
                            return {
                                contact: {
                                    personName: shippingAddressSubrecord.getValue({ fieldId: 'attention' }) ||
                                               shippingAddressSubrecord.getValue({ fieldId: 'addressee' }) ||
                                               salesOrderRecord.getText({ fieldId: 'entity' }) ||
                                               'Customer',
                                    phoneNumber: fedexHelper.validatePhoneNumber(shippingAddressSubrecord.getValue({ fieldId: 'addrphone' }))
                                },
                                address: {
                                    streetLines: streetLines,
                                    city: city,
                                    stateOrProvinceCode: state,
                                    postalCode: zip,
                                    countryCode: countryCode,
                                    residential: residentialBool
                                }
                            };
                        }
                    }
                } catch (subrecordError) {
                    log.debug('Shipping Address Subrecord Warning', 'Could not access shippingaddress as subrecord: ' + subrecordError.message);
                }
                
                // Fallback: use customer address or default
                log.debug('Recipient Info Fallback', 'Using fallback address');
                return {
                    contact: {
                        personName: salesOrderRecord.getText({ fieldId: 'entity' }) || 'Customer',
                        phoneNumber: '9999999999'
                    },
                    address: {
                        streetLines: ['Address Not Available'],
                        city: 'Unknown',
                        stateOrProvinceCode: 'XX',
                        postalCode: '00000',
                        countryCode: 'US'
                    }
                };
                
            } catch (e) {
                log.error({
                    title: 'Recipient Info Error',
                    details: 'Error building recipient info: ' + e.message
                });
                throw e;
            }
        }
        
        /**
         * Extract rate from FedEx API response
         *
         * @param {Object} apiResponse The FedEx API response
         * @param {string} fedexServiceCode The FedEx service code used in request
         * @returns {number} Shipping rate amount
         */
        function extractRateFromResponse(apiResponse, fedexServiceCode) {
            try {
                log.debug('Extract Rate', 'Extracting rate from response for service: ' + fedexServiceCode);
                
                // FedEx Rate API response structure:
                // output.rateReplyDetails[].ratedShipmentDetails[].totalNetCharge (number, not object with amount)
                if (apiResponse && apiResponse.output && apiResponse.output.rateReplyDetails) {
                    var rateReplyDetails = apiResponse.output.rateReplyDetails;
                    
                    log.debug('Extract Rate', 'Found ' + rateReplyDetails.length + ' rate reply details');
                    
                    // First, try to find exact match for requested service code
                    for (var i = 0; i < rateReplyDetails.length; i++) {
                        var rateDetail = rateReplyDetails[i];
                        log.debug('Extract Rate', 'Checking service type: ' + rateDetail.serviceType);
                        
                        // Check if this rate detail matches our service code
                        if (rateDetail.serviceType === fedexServiceCode && rateDetail.ratedShipmentDetails) {
                            var ratedShipments = rateDetail.ratedShipmentDetails;
                            
                            // Get the first rated shipment (should only be one for ACCOUNT rate type)
                            if (ratedShipments.length > 0) {
                                var ratedShipment = ratedShipments[0];
                                
                                // totalNetCharge is a number directly, not an object with amount property
                                if (ratedShipment.totalNetCharge !== undefined && ratedShipment.totalNetCharge !== null) {
                                    var rate = parseFloat(ratedShipment.totalNetCharge);
                                    log.debug('Extract Rate', 'Found matching rate for ' + fedexServiceCode + ': ' + rate);
                                    return rate;
                                }
                            }
                        }
                    }
                    
                    // If we didn't find exact match, use the first available rate
                    log.debug('Extract Rate', 'No exact match found for ' + fedexServiceCode + ', using first available rate');
                    if (rateReplyDetails.length > 0 && rateReplyDetails[0].ratedShipmentDetails) {
                        var firstRatedShipment = rateReplyDetails[0].ratedShipmentDetails[0];
                        if (firstRatedShipment && firstRatedShipment.totalNetCharge !== undefined && firstRatedShipment.totalNetCharge !== null) {
                            var fallbackRate = parseFloat(firstRatedShipment.totalNetCharge);
                            var fallbackService = rateReplyDetails[0].serviceType || 'Unknown';
                            log.debug('Extract Rate', 'Using fallback rate from ' + fallbackService + ': ' + fallbackRate);
                            return fallbackRate;
                        }
                    }
                }
                
                throw error.create({
                    name: 'RATE_EXTRACTION_ERROR',
                    message: 'Could not extract rate from FedEx API response. Response structure: ' + JSON.stringify(apiResponse)
                });
                
            } catch (e) {
                log.error({
                    title: 'Extract Rate Error',
                    details: 'Error extracting rate from response: ' + e.message
                });
                throw e;
            }
        }
        
        return {
            getRateQuote: getRateQuote,
            buildRateQuotePayload: buildRateQuotePayload
        };
    }
);

