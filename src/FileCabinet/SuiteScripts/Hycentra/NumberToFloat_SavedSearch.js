/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * 
 * This script demonstrates how to format a number as a float in a Saved Search
 * For example: 20 -> 20.0
 */
define(['N/search', 'N/ui/serverWidget', 'N/format'], function(search, serverWidget, format) {
    
    /**
     * Function to be executed when parameter is "create"
     * Creates a Saved Search with a float-formatted column
     */
    function createSavedSearch() {
        try {
            // Create a new saved search
            var savedSearch = search.create({
                type: search.Type.ITEM,
                filters: [
                    ['type', search.Operator.ANYOF, 'InvtPart'],
                    'AND',
                    ['isinactive', search.Operator.IS, 'F']
                ],
                columns: [
                    search.createColumn({name: 'itemid', label: 'Item ID'}),
                    search.createColumn({name: 'quantityavailable', label: 'Quantity Available'}),
                    // Method 1: Using TO_NUMBER function with format mask
                    search.createColumn({
                        name: 'formulanumeric',
                        formula: 'TO_NUMBER({quantityavailable}, \'0.0\')',
                        label: 'Quantity (Float)'
                    }),
                    // Method 2: Using ROUND function to ensure decimal places
                    search.createColumn({
                        name: 'formulanumeric',
                        formula: 'ROUND({quantityavailable}, 1)',
                        label: 'Quantity (Rounded)'
                    }),
                    // Method 3: Using DECIMAL function for more control
                    search.createColumn({
                        name: 'formulanumeric',
                        formula: 'DECIMAL({quantityavailable}, 1)',
                        label: 'Quantity (Decimal)'
                    })
                ],
                title: 'Items with Float Formatted Quantities'
            });
            
            // Save the search
            var searchId = savedSearch.save();
            
            return searchId;
        } catch (e) {
            log.error('Error creating saved search', e);
            throw e;
        }
    }
    
    /**
     * Function to be executed when parameter is "view"
     * Displays a form with the Saved Search results
     */
    function viewSavedSearch(searchId) {
        try {
            // Load the saved search
            var savedSearch = search.load({
                id: searchId
            });
            
            // Run the search
            var searchResultSet = savedSearch.run();
            var searchResults = searchResultSet.getRange(0, 100);
            
            // Create a form to display the results
            var form = serverWidget.createForm({
                title: 'Saved Search Results: ' + savedSearch.title
            });
            
            // Add a field to display the search ID
            form.addField({
                id: 'custpage_searchid',
                type: serverWidget.FieldType.TEXT,
                label: 'Search ID',
                defaultValue: searchId
            });
            
            // Create a sublist to display the search results
            var sublist = form.addSublist({
                id: 'custpage_results',
                type: serverWidget.SublistType.LIST,
                label: 'Search Results'
            });
            
            // Add columns to the sublist
            sublist.addField({
                id: 'custpage_itemid',
                type: serverWidget.FieldType.TEXT,
                label: 'Item ID'
            });
            
            sublist.addField({
                id: 'custpage_quantity',
                type: serverWidget.FieldType.TEXT,
                label: 'Quantity Available'
            });
            
            sublist.addField({
                id: 'custpage_quantity_float',
                type: serverWidget.FieldType.TEXT,
                label: 'Quantity (Float)'
            });
            
            sublist.addField({
                id: 'custpage_quantity_rounded',
                type: serverWidget.FieldType.TEXT,
                label: 'Quantity (Rounded)'
            });
            
            sublist.addField({
                id: 'custpage_quantity_decimal',
                type: serverWidget.FieldType.TEXT,
                label: 'Quantity (Decimal)'
            });
            
            // Populate the sublist with search results
            for (var i = 0; i < searchResults.length; i++) {
                var result = searchResults[i];
                
                sublist.setSublistValue({
                    id: 'custpage_itemid',
                    line: i,
                    value: result.getValue('itemid')
                });
                
                sublist.setSublistValue({
                    id: 'custpage_quantity',
                    line: i,
                    value: result.getValue('quantityavailable')
                });
                
                sublist.setSublistValue({
                    id: 'custpage_quantity_float',
                    line: i,
                    value: result.getValue({
                        name: 'formulanumeric',
                        formula: 'TO_NUMBER({quantityavailable}, \'0.0\')'
                    })
                });
                
                sublist.setSublistValue({
                    id: 'custpage_quantity_rounded',
                    line: i,
                    value: result.getValue({
                        name: 'formulanumeric',
                        formula: 'ROUND({quantityavailable}, 1)'
                    })
                });
                
                sublist.setSublistValue({
                    id: 'custpage_quantity_decimal',
                    line: i,
                    value: result.getValue({
                        name: 'formulanumeric',
                        formula: 'DECIMAL({quantityavailable}, 1)'
                    })
                });
            }
            
            return form;
        } catch (e) {
            log.error('Error viewing saved search', e);
            throw e;
        }
    }
    
    /**
     * Function to be executed when parameter is "onRequest"
     * Entry point for the Suitelet
     */
    function onRequest(context) {
        try {
            var action = context.request.parameters.action;
            var searchId = context.request.parameters.searchid;
            
            if (action === 'create') {
                var newSearchId = createSavedSearch();
                
                // Redirect to view the newly created search
                redirect.toSuitelet({
                    scriptId: 'customscript_numbertofloat_savedsearch',
                    deploymentId: 'customdeploy_numbertofloat_savedsearch',
                    parameters: {
                        action: 'view',
                        searchid: newSearchId
                    }
                });
            } else if (action === 'view' && searchId) {
                return viewSavedSearch(searchId);
            } else {
                // Create a form with buttons to create or view a search
                var form = serverWidget.createForm({
                    title: 'Number to Float Saved Search'
                });
                
                form.addField({
                    id: 'custpage_message',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ' ',
                    defaultValue: '<p>This script demonstrates how to format a number as a float in a Saved Search.</p>'
                });
                
                form.addSubmitButton({
                    label: 'Create New Saved Search'
                });
                
                form.clientScriptModulePath = './NumberToFloat_SavedSearch_CS.js';
                
                return form;
            }
        } catch (e) {
            log.error('Error in onRequest', e);
            throw e;
        }
    }
    
    return {
        onRequest: onRequest
    };
}); 