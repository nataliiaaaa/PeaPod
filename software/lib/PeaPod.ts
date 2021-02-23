import { DeviceFlowUI, DeviceFlowUIOptions } from '@openformtech/firebasedeviceflow';
import firebase from 'firebase';
import { IPeaPodArduino, PeaPodArduinoInterface } from './PeaPodArduino';
import { ArduinoSimulator } from './PeaPodSimulator'
import { IPeaPodPublisher, PeaPodFirebase } from './PeaPodFirebase';
import inquirer from 'inquirer';

export type MessageType = 'info' | 'data' | 'debug' | 'error';

export type PeaPodMessage = {
    type: MessageType,
    msg: any
}

const firebaseConfig : {[key: string]: string} = {
    apiKey: "AIzaSyC7iBFv4PEmWss4h_Ul01Mpkzgpu2GuXao",
    authDomain: "peapod-283416.firebaseapp.com",
    databaseURL: "https://peapod-283416.firebaseio.com",
    projectId: "peapod-283416",
    storageBucket: "peapod-283416.appspot.com",
    messagingSenderId: "513099710307",
    appId: "1:513099710307:web:bf82ec0946b233a0f79d56",
    measurementId: "G-WR33SVX7DJ"
}

const authConfig : DeviceFlowUIOptions = {
    Google : {
        clientid : '513099710307-78rqvpchfe8qissqgaugp160nsa1d4t5.apps.googleusercontent.com',
        clientsecret : 'YKCeZITc11tfDAypvT2q4Ld9',
        scopes : ['email', 'profile']
    },
    GitHub : {
        clientid : 'f982a1faefcf73eb1268',
        scopes : ['read:user', 'user:email']
    }
}

export default class PeaPod {
    arduino : IPeaPodArduino | undefined;
    firebase : IPeaPodPublisher | undefined;
    constructor(readonly simulated : boolean = true){
        firebase.initializeApp(firebaseConfig);
    }

    async authenticate() : Promise<firebase.User> {
        let login = new DeviceFlowUI(firebase.app(), authConfig);
        return login.signIn();
    }

    async setup(logger: (msg: string, finished: boolean) => void) : Promise<void> {
        if(this.simulated){
            this.arduino = new ArduinoSimulator({
                air_temperature: {
                    min: 10,
                    max: 20,
                    interval: 2000
                },
                water_level: {
                    min: 0,
                    max: 1,
                    interval: 1000
                }
            });
        } else {
            this.arduino = new PeaPodArduinoInterface();
        }
        let project = await selectProject();
        if(!project){
            return;
        }
        let run = await selectRun(project);
        this.firebase = new PeaPodFirebase({
            projectid: firebaseConfig['projectId'],
            cloudregion: 'us-central1',
            registryid: 'cloudponics-devices',
            jwtexpiryminutes: 20
        },
        {
            project: project.id,
            run: run.id
        });
        this.firebase.initialize(logger);
    }
}

/**
 * Select a run owned by the current user under a given project.
 * @returns {Promise<firebase.firestore.DocumentReference | undefined>}
 */
async function selectRun(project : firebase.firestore.DocumentReference) : Promise<firebase.firestore.DocumentReference<firebase.firestore.DocumentData>> {
    const runs : {
        id: string, 
        ref: firebase.firestore.DocumentReference
    }[] = (await project.collection('runs').get()).docs.map(doc=>{
        return {
            id: doc.id,
            ref: doc.ref
        }
    });
    const ref = (await inquirer.prompt([
        {
            type: 'list',
            name: 'ref',
            message: 'Select a run:',
            choices: runs.map(run=>{return {name: run.id, value: run.ref};})
        }
    ])).ref;
    return ref;
}

/**
 * Select a project owned by the current user
 * @returns {Promise<firebase.firestore.DocumentReference | undefined>}
 */
async function selectProject() : Promise<firebase.firestore.DocumentReference<firebase.firestore.DocumentData> | undefined> {
    const userdoc = firebase.firestore().doc('users/'+firebase.auth().currentUser?.uid);
    const projectids = (await userdoc.get()).get('projects') as string[];
    let projects : {
        id: string,
        name: string,
        ref: firebase.firestore.DocumentReference
    }[] = [];
    if(!projects){
        console.log("No projects found! Create one first.");
        return;
    }
    for(const projectid of projectids){
        const projectname = (await firebase.firestore().doc('projects/'+projectid).get()).get('name');
        projects.push({
            id: projectid,
            name: projectname,
            ref: firebase.firestore().doc('projects/'+projectid)
        });
    }
    const ref = (await inquirer.prompt([
        {
            type: 'list',
            name: 'ref',
            message: 'Select a project:',
            choices: projects.map(project=>{return {name: project.name+' - '+project.id, value: project.ref};})
        }
    ])).ref;
    return ref;
}