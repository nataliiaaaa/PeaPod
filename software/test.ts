import chalk from 'chalk';
import ora from 'ora';
import { ArduinoSimulator, SimulatorParameters, ArduinoData, TDataLabels } from './lib/PeaPodSimulator';
import { PeaPodFirebase } from './lib/PeaPodFirebase';
import firebase from 'firebase';

const sleep = (millis : number) => {
    return new Promise(resolve => {
        setTimeout(resolve, millis);
    });
};

const defaultSpinner : ora.Spinner = {
    interval: 50,
    frames: [
        "▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
        "█▁▁▁▁▁▁▁▁▁▁▁▁▁▁",
        "██▁▁▁▁▁▁▁▁▁▁▁▁▁",
        "███▁▁▁▁▁▁▁▁▁▁▁▁",
        "████▁▁▁▁▁▁▁▁▁▁▁",
        "█████▁▁▁▁▁▁▁▁▁▁",
        "▁█████▁▁▁▁▁▁▁▁▁",
        "▁▁█████▁▁▁▁▁▁▁▁",
        "▁▁▁█████▁▁▁▁▁▁▁",
        "▁▁▁▁█████▁▁▁▁▁▁",
        "▁▁▁▁▁█████▁▁▁▁▁",
        "▁▁▁▁▁▁█████▁▁▁▁",
        "▁▁▁▁▁▁▁█████▁▁▁",
        "▁▁▁▁▁▁▁▁█████▁▁",
        "▁▁▁▁▁▁▁▁▁█████▁",
        "▁▁▁▁▁▁▁▁▁▁█████",
        "▁▁▁▁▁▁▁▁▁▁▁████",
        "▁▁▁▁▁▁▁▁▁▁▁▁███",
        "▁▁▁▁▁▁▁▁▁▁▁▁▁██",
        "▁▁▁▁▁▁▁▁▁▁▁▁▁▁█",
    ]
}

async function arduinoSimulatorTest() : Promise<void> {
    var loading : ora.Ora;
    const params : SimulatorParameters = {
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
    };
    const arduino = new ArduinoSimulator(params);
    loading = ora({
        text: `Running Arduino simulator tests (Passed 0/${Object.keys(params).length})...`,
        spinner: defaultSpinner
    }).start();
    let uniquekeysrecieved : string[] = [];
    await sleep(500);
    return new Promise<void>((res, rej)=>{
        arduino.start(msg=>{
            if(msg.type == 'error'){
                arduino.stop();
                loading.fail(`Arduino simulator test failed: Recieved error: '${JSON.stringify(msg.msg)}'`);
                rej();
            } else if(msg.type == 'data'){
                const data = msg as ArduinoData;
                let key = Object.keys(data.msg)[0].replace('-','_');
                let value = Object.values(msg.msg)[0] as number;
                if(!(key in uniquekeysrecieved)){
                    uniquekeysrecieved.push(key);
                    loading.text = `Running Arduino tests (Passed ${uniquekeysrecieved.length}/${Object.keys(params).length})...`;
                }
                if(!Object.keys(params).includes(key)){
                    arduino.stop();
                    loading.fail(`Arduino simulator test failed: Unexpected key '${key}' recieved.`);
                    console.log(Object.keys(params));
                    rej();
                } else if(value < params[key as TDataLabels].min || value > params[key as TDataLabels].max){
                    arduino.stop();
                    loading.fail(`Arduino simulator test failed: Value for '${key}' (${value}) falls outside range ${params[key as TDataLabels].min} to ${params[key as TDataLabels].max}.`);
                    rej();
                }
                if(uniquekeysrecieved.length == Object.keys(params).length){
                    arduino.stop();
                    loading.succeed('All Arduino simulator tests passed.');
                    res();
                }
            }
        });
    });
}

async function deviceRegisterTest() : Promise<void> {
    var loading : ora.Ora;
    loading = ora({
        text: `Running IoT device registry test...`,
        spinner: defaultSpinner
    }).start();
    await sleep(500);
    const pfirebase = new PeaPodFirebase({
        projectid: "peapod-283416",
        cloudregion: 'us-central1',
        registryid: 'cloudponics-devices',
        jwtexpiryminutes: 20
    },
    {
        project: 'test-project',
        run: 'test-project-94db91f4-b4bb-455b-92dd-faa9a7432640'
    });
    try{
        return pfirebase.initialize((msg : string, finished: boolean)=>{
            if(!loading.isSpinning){
                loading = ora({
                    text: msg,
                    spinner: defaultSpinner,
                }).start();
            }
            if(finished){
                loading.succeed(msg);
            } else {
                loading.text = msg;
            }
        })
    } catch (err) {
        loading.stop();
        throw err;
    }
}

// Main

firebase.initializeApp({
    apiKey: "AIzaSyC7iBFv4PEmWss4h_Ul01Mpkzgpu2GuXao",
    authDomain: "peapod-283416.firebaseapp.com",
    databaseURL: "https://peapod-283416.firebaseio.com",
    projectId: "peapod-283416",
    storageBucket: "peapod-283416.appspot.com",
    messagingSenderId: "513099710307",
    appId: "1:513099710307:web:bf82ec0946b233a0f79d56",
    measurementId: "G-WR33SVX7DJ"
});

arduinoSimulatorTest().then(()=>{
    deviceRegisterTest().then(()=>{
        console.log(chalk.green('All tests passed.'));
    }).catch((err)=>{
        console.log(chalk.red('Some test(s) failed: ')+JSON.stringify(err));
    });
}).catch((err)=>{
    console.log(chalk.red('Some test(s) failed: ')+JSON.stringify(err));
});