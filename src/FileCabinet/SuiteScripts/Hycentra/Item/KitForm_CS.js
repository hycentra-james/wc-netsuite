/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */

define(['N/record', 'N/search', 'N/ui/message', 'N/ui/dialog', './itemFormHelper'],
    function(record, search, message, dialog, formHelper) {
        var currentRecord;
        var scriptInitiatedChange = false;

        // This is the variable for holding the name of the field group
        var allFieldGroups = [
            'Backsplash', // 0
            'Bath Accessories',  // 1
            'Bathroom Vanities', // 2
            'Faucets',  // 3
            'Kitchen Sinks', // 4
            'Linen Cabinet', // 5
            'Medicine Cabinets', // 6
            'Mirror', // 7
            'Wash Stands' // 8
        ];

        function pageInit(context) {
            currentRecord = context.currentRecord;

            setStickyCategory();

            if (context.mode === 'edit') {
                //var currentRec = currentRecord.get();
                var productCategory = currentRecord.getValue({ fieldId: 'class' });
                
                // Hide all field group by default
                allFieldGroups.forEach(function(fieldGroup){
                    hideFieldGroup(fieldGroup);
                });
                
                // Get all member items and determine which field group required 
                var memberItems = getMemberItems(currentRecord.id);
    
                // Show all field group base on the member item category
                memberItems.forEach(function(member) {
                    var memberName = member.getValue('name');
                    var memberCat = member.getValue('class');
    
                    if (memberCat) {
                        console.log("memberCat = " + memberCat);
                        if (memberCat) {
                            var fieldGroupMap = getCategoryFieldGroupMap(memberCat);

                            if (fieldGroupMap && Object.keys(fieldGroupMap).length > 0) {
                                fieldGroupMap.forEach(function(mapIndex){
                                    showFieldGroup(allFieldGroups[mapIndex]);
                                });
                            }
                        }
                    }
                })
    
                // $('#tr_fg_fieldGroup7').hide();
                //$("td[data-nsps-label='Linen Cabinet']").hide();
                // Get the tdElement
                // hideFieldGroup('Medicine Cabinets');
                // hideFieldGroup('Mirror');
                // hideFieldGroup('Wash Stands');
    
                /*
                // Get all field IDs for the dummy record
                var fieldIds = record.load(
                    {
                         type: record.Type.KIT_ITEM,
                         id: currentRecord.id
                    }
                ).getFields();
    
    
                // Iterate over the field IDs using forEach
                fieldIds.forEach(function(fieldId) {
                    if (fieldId.startsWith("custitem_hyc_")) {
                        if (fieldId === 'custitem_hyc_washstands_finish' || fieldId === 'custitem_hyc_washstands_mat'){
                            currentRecord.getField(fieldId).isVisible = false;
                        }
                        console.log(fieldId);
                    }
                    // If you want to send the field names as a response to the client
                    // context.response.write('Field Name for ' + recordType + ': ' + fieldId + '<br>');
                });
                */
            }
        }

        function setStickyCategory() {
            var currentCategoryId = currentRecord.getValue({fieldId: 'class'});

            if (currentCategoryId) {
                var formCategoryId = formHelper.getFormCategoryId(6, currentCategoryId, currentRecord.getValue({fieldId: 'customform'}));
        
                if (formCategoryId && currentCategoryId != formCategoryId) {
                    scriptInitiatedChange = true;
                    currentRecord.setValue({
                        fieldId: 'class',
                        value: formCategoryId
                    });
                }
            }
        }

        function fieldChanged(context) {
            if (scriptInitiatedChange) {
                // Reset the flag and return to avoid infinite loop
                scriptInitiatedChange = false;
                return;
            } else {
                // Check if the field changed is the product category
                if (context.fieldId === 'class') {
                    var categoryId = currentRecord.getValue({fieldId: 'class'});

                    // Change the input form base on the category
                    currentRecord.setValue({
                        fieldId: 'customform',
                        value: formHelper.getCategoryFormId(6, categoryId)
                    });
    
                    // Set the flag to true to indicate a script-initiated change
                    scriptInitiatedChange = true;
    
                    // Set the category code
                    currentRecord.setValue({
                        fieldId: 'class',
                        value: categoryId
                    });
                }
            }
        }
        
        function showFieldGroup(fieldGroupName) {
            getFieldGroupRowElement(fieldGroupName).show();
        }

        function hideFieldGroup(fieldGroupName) {
            getFieldGroupRowElement(fieldGroupName).hide();
        }

        function getFieldGroupRowElement(fieldGroupName){
            var tdElement = $("td.fgroup_title[data-nsps-label='" + fieldGroupName + "']");
        
            // Traverse up the DOM until you reach the table element
            var tableElement = tdElement;
            while (tableElement.prop("tagName") !== "TABLE") {
                tableElement = tableElement.parent();
                if (!tableElement.length) {
                    // If no table element is found, break the loop
                    break;
                }
            }

            return tableElement.parent().parent();
        }
        
        // Return the map that contains all the field groups for a particular category
        // Input parameter: catId - Category ID of the Kit
        function getCategoryFieldGroupMap(catId) {
            //1 - Bathroom Vanities *
            //2 - Wash Stands *
            //3 - Medicine Cabinets *
            //4 - Linen Cabinets *
            //5 - Counter Tops
            //6 - Mirrors
            //7 - Cabinet Hardware
            //8 - Faucets *
            //9 - Kitchen Sinks *
            //10 - Bath Accessories
            //11 - Office Furniture
            //12 - Backsplash
            //13 - Aerator *
            //14 - Cartridge *
            //15 - Diverter *
            //16 - Faucet Body *
            //17 - Hand Shower *
            //18 - Handle *
            //19 - Handle Index Button *
            //20 - Hardware Kit *
            //21 - Pop-Up Drain *
            //22 - Risers *
            //24 - Shower Cradle *
            //25 - Shower Hose *
            //26 - Sprayer Part *
            //27 - Straight Arms *
            //28 - Swivel Arms *

            var catFieldGroupsMap = {};

            // Store an array as the value for a key
            catFieldGroupsMap[1] = [2];   
            catFieldGroupsMap[2] = [8]; 
            catFieldGroupsMap[3] = [6]; 
            catFieldGroupsMap[4] = [5]; 
            catFieldGroupsMap[6] = [7]; 
            catFieldGroupsMap[16] = [3]; 
            catFieldGroupsMap[9] = [4];
            catFieldGroupsMap[10] = [1]; 
            catFieldGroupsMap[12] = [0]; 

            if (catFieldGroupsMap.hasOwnProperty(catId)) {
                return catFieldGroupsMap[catId];
            } else {
                return null;
            }
        }

        // Function to retrieve all member items of a kit
        function getMemberItems(kitItemId) {
            var memberItems = [];
            
            // Look up the Kit
            var kitItemSearch = search.create({
                type: search.Type.KIT_ITEM,
                filters: [
                    ['internalid', search.Operator.ANYOF, kitItemId]
                ],
                columns: [
                    'memberitem',
                ]
            });

            var kitMembersRS = kitItemSearch.run().getRange({ start: 0, end: 50 });

            console.log("Member count : " + kitItemSearch.runPaged().count);

            // For each member in the kit
            kitMembersRS.forEach(function(rs) {
                var memberItemId = rs.getValue('memberitem');

                var itemSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ['internalid', search.Operator.ANYOF, memberItemId, 'and',
                            'type', search.Operator.ANYOF, 'InvtPart'
                        ]
                    ],
                    columns: [
                        'internalid',
                        'name',
                        'class'
                    ]
                });

                var itemMemberRS = itemSearch.run().getRange({ start: 0, end: 10 });

                itemMemberRS.forEach(function(itemMember) {
                    // Add to the returned memberItems
                    memberItems.push(itemMember);
                });
                
            })
            
            return memberItems;
        }

        return {
            // fieldChanged: fieldChanged,
            // pageInit: pageInit
        };

    });

