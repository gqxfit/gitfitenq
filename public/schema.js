export const services = {
  'Online training': {tag:'01 / TRAIN ANYWHERE',description:'Personal coaching that fits your routine, wherever you train.',fields:[
    ['goal','Your main goal','select',['Fat loss','Strength','Beginner fitness','Specialised fitness support','Build strength','Lose fat','Improve fitness','Build muscle','General wellbeing']],
    ['experience','Training experience','select',['Beginner','Some experience','Experienced']],
    ['trainingPlace','Where will you train?','select',['Home','Gym','Both','Need guidance']],
    ['sessions','Preferred sessions per week','select',['2','3','4','5','6']],
    ['timeZone','Your time zone','text',null,'e.g. India / IST'],
    ['preferredTime','Preferred training time','select',['Morning','Afternoon','Evening','Flexible']]
  ]},
  'Offline training': {tag:'02 / SHOW UP STRONG',description:'Enquire about in-person coaching and find a routine that works for you.',fields:[
    ['area','Preferred training area / locality','text'],
    ['trainingPlace','Where would you prefer to train?','select',['Home','Gym','Need guidance'],null,false],
    ['goal','Your main goal','select',['Fat loss','Strength','Beginner fitness','Specialised fitness support','Build strength','Lose fat','Improve fitness','Build muscle','General wellbeing']],
    ['experience','Training experience','select',['Beginner','Some experience','Experienced']],
    ['sessions','Preferred sessions per week','select',['2','3','4','5','6']],
    ['preferredTime','Preferred training time','select',['Morning','Afternoon','Evening','Flexible']]
  ]},
  'Apartment training': {tag:'03 / STRONGER TOGETHER',description:'Bring fitness to your community. Tell us about your apartment and group.',fields:[
    ['apartment','Apartment / community name','text'],['area','Locality','text'],
    ['role','You are enquiring as','select',['Resident','Committee / association','Property manager','Other']],
    ['participants','Estimated participants','number',null,'Approximate group size'],
    ['space','Available training space','select',['Apartment gym','Clubhouse','Outdoor space','Need guidance']],
    ['preferredTime','Preferred training time','select',['Morning','Afternoon','Evening','Flexible']]
  ]},
  'Meal box': {tag:'04 / FUEL YOUR EVERYDAY',description:'Explore meal boxes for your routine. Availability and delivery are confirmed by our team.',fields:[
    ['area','Delivery locality','text'],['pincode','Delivery PIN code','pincode'],
    ['diet','Food preference','select',['Vegetarian','Non-vegetarian','Eggetarian','Vegan']],
    ['meals','Meals per day','select',['1','2','3','4']],
    ['duration','Plan preference','select',['Trial','Weekly','Monthly']],
    ['startDate','Preferred start date (optional)','date',null,null,false]
  ]},
  'GQX Fit clothing': {tag:'05 / WEAR YOUR COMMITMENT',description:'Discover GQX Fit clothing, choose your fit, and send a product enquiry.',fields:[]},
  'Other': {tag:'06 / LET’S TALK',description:'Something else in mind? Leave a message for the GQX Fit team.',fields:[['interest','What would you like to know?','text']]}
};
export const detailLabels={city:'City',contactPreference:'Preferred contact',...Object.fromEntries(Object.values(services).flatMap(s=>s.fields).map(f=>[f[0],f[1]])),size:'Size',color:'Colour',quantity:'Quantity',product:'Product',unitPrice:'Unit price',total:'Estimated total'};
