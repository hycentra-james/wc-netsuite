/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 * 
 * Client script for the NumberToFloat_SavedSearch Suitelet
 */
define([], function() {
    
    /**
     * Function to be executed when form is submitted
     * Redirects to create a new saved search
     */
    function saveRecord(context) {
        try {
            // Redirect to create a new saved search
            window.location.href = window.location.href + '&action=create';
            return false; // Prevent form submission
        } catch (e) {
            console.error('Error in saveRecord', e);
        }
    }
    
    return {
        saveRecord: saveRecord
    };
}); 