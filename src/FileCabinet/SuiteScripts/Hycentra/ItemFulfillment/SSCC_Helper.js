/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @description SSCC (Serial Shipping Container Code) Helper Class
 * @author Your Name
 */
define(['N/log', 'N/record', 'N/search'], function(log, record, search) {

    /**
     * SSCC Configuration Constants
     */
    const SSCC_CONFIG = {
        APPLICATION_IDENTIFIER: '00',
        EXTENSION_DIGIT: '8',
        GS1_COMPANY_PREFIX: '59657',
        STARTING_COUNTER: 2800000,
        CUSTOM_RECORD_TYPE: 'customrecord_hyc_sscc_config',
        COUNTER_FIELD: 'custrecord_hyc_sscc_counter'
    };

    /**
     * Generate a new SSCC code
     * @returns {string|null} Complete 18-digit SSCC code or null if generation fails
     */
    function generateSSCC() {
        try {
            log.debug('SSCC Helper', 'Starting SSCC generation');

            // Get current counter value
            var currentCounter = getCurrentCounter();
            if (!currentCounter) {
                log.error('SSCC Helper', 'Unable to retrieve counter, SSCC generation failed');
                return null;
            }

            log.debug('SSCC Helper', 'Current counter value: ' + currentCounter);

            // Generate SSCC code
            var ssccCode = buildSSCCCode(currentCounter);

            // Update counter for next use
            updateCounter(currentCounter + 1);

            log.debug('SSCC Helper', 'Generated SSCC: ' + ssccCode);
            return ssccCode;

        } catch (e) {
            log.error('SSCC Helper Error', 'Error generating SSCC: ' + e.message);
            return null;
        }
    }

    /**
     * Build SSCC code using the specified format
     * @param {number} serialNumber - The sequential number to use
     * @returns {string} Complete 18-digit SSCC code
     */
    function buildSSCCCode(serialNumber) {
        // Format: Application Identifier (2) + Extension Digit (1) + GS1 Company Prefix (5) + Serial Number (9) + Check Digit (1)
        
        // Pad serial number to 8 digits
        var paddedSerial = String(serialNumber).padStart(9, '0');
        
        // Construct SSCC without check digit
        var ssccWithoutCheck = SSCC_CONFIG.APPLICATION_IDENTIFIER + 
                              SSCC_CONFIG.EXTENSION_DIGIT + 
                              SSCC_CONFIG.GS1_COMPANY_PREFIX + 
                              paddedSerial;
        
        // Calculate check digit
        var checkDigit = calculateCheckDigit(ssccWithoutCheck);
        
        // Complete SSCC code
        var completeSSCC = ssccWithoutCheck + checkDigit;
        
        log.debug('SSCC Build Details', {
            serialNumber: serialNumber,
            paddedSerial: paddedSerial,
            ssccWithoutCheck: ssccWithoutCheck,
            checkDigit: checkDigit,
            completeSSCC: completeSSCC
        });
        
        return completeSSCC;
    }

    /**
     * Calculate check digit using GS1 modulo-10 algorithm
     * @param {string} ssccWithoutCheck - SSCC code without check digit (17 digits)
     * @returns {string} Single check digit
     */
    function calculateCheckDigit(ssccWithoutCheck) {
        var sum = 0;
        var multiplier = 3; // Start with 3 for rightmost digit
        
        // Process digits from right to left
        for (var i = ssccWithoutCheck.length - 1; i >= 0; i--) {
            var digit = parseInt(ssccWithoutCheck.charAt(i));
            sum += digit * multiplier;
            
            // Alternate between 3 and 1
            multiplier = (multiplier === 3) ? 1 : 3;
        }
        
        // Calculate check digit
        var remainder = sum % 10;
        var checkDigit = (remainder === 0) ? 0 : (10 - remainder);
        
        log.debug('Check Digit Calculation', {
            ssccWithoutCheck: ssccWithoutCheck,
            sum: sum,
            remainder: remainder,
            checkDigit: checkDigit
        });
        
        return String(checkDigit);
    }

    /**
     * Get current counter value from SSCC configuration record
     * @returns {number|null} Current counter value or null if not found
     */
    function getCurrentCounter() {
        try {
            var configSearch = search.create({
                type: SSCC_CONFIG.CUSTOM_RECORD_TYPE,
                columns: [SSCC_CONFIG.COUNTER_FIELD]
            });

            var searchResult = configSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (searchResult.length > 0) {
                var counterValue = searchResult[0].getValue(SSCC_CONFIG.COUNTER_FIELD);
                return parseInt(counterValue) || SSCC_CONFIG.STARTING_COUNTER;
            } else {
                log.error('SSCC Configuration', 'No SSCC configuration record found');
                return null;
            }
        } catch (e) {
            log.error('SSCC Configuration Error', 'Error retrieving counter: ' + e.message);
            return null;
        }
    }

    /**
     * Update counter value in SSCC configuration record
     * @param {number} newCounterValue - New counter value to set
     */
    function updateCounter(newCounterValue) {
        try {
            var configSearch = search.create({
                type: SSCC_CONFIG.CUSTOM_RECORD_TYPE,
                columns: ['internalid']
            });

            var searchResult = configSearch.run().getRange({
                start: 0,
                end: 1
            });

            if (searchResult.length > 0) {
                var recordId = searchResult[0].getValue('internalid');
                
                var configRecord = record.load({
                    type: SSCC_CONFIG.CUSTOM_RECORD_TYPE,
                    id: recordId
                });

                configRecord.setValue({
                    fieldId: SSCC_CONFIG.COUNTER_FIELD,
                    value: newCounterValue
                });

                configRecord.save();
                
                log.debug('SSCC Counter Update', 'Counter updated to: ' + newCounterValue);
            } else {
                log.error('SSCC Counter Update', 'No configuration record found to update');
            }
        } catch (e) {
            log.error('SSCC Counter Update Error', 'Error updating counter: ' + e.message);
        }
    }

    /**
     * Get SSCC configuration constants (useful for testing or external reference)
     * @returns {Object} SSCC configuration object
     */
    function getConfig() {
        return SSCC_CONFIG;
    }

    // Public API
    return {
        generateSSCC: generateSSCC,
        getConfig: getConfig
    };
});
