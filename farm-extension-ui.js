export async function handleFarmExtension(action,control,context){
 const routes=[[/^(zones|zone-|prescription|actual|results|result-|decisions)/,'./precision-ui.js','precisionAction'],[/^applied/,'./application-ui.js','applicationAction'],[/^(scanner|registry|observation|team|mission)/,'./operations-ui.js','operationsAction'],[/^(connection|machine|sensor)/,'./connections-ui.js','connectionsAction'],[/^(economics|economic-|agent)/,'./economic-ui.js','economicAction'],[/^(harvest|parcel-score|share-parcel)/,'./harvest-ui.js','harvestAction']];
 const route=routes.find(([pattern])=>pattern.test(action));if(route){const module=await import(route[1]);context.guard();if(await module[route[2]](action,control,context))return;}throw Error('Action de pilotage inconnue.');
}
