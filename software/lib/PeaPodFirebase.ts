import { PeaPodMessage } from './PeaPod';
import * as iot from '@google-cloud/iot';
import {PubSub} from '@google-cloud/pubsub';
import firebase from 'firebase';
import * as fs from 'fs';
import { default as namegen } from 'project-name-generator';
import * as jwt from 'jsonwebtoken';
import * as mqtt from 'mqtt';
import axios from 'axios';
import { MqttClient } from 'mqtt';

export interface IPeaPodPublisher {
    // Set up interfaces
    initialize(logger : (msg: string, finished: boolean) => void) : Promise<void>,
    // Attach callbacks
    start(onmessage: (topic: string, msg: string) => void, onerror: (err: Error) => void) : void,
    // Publish a message
    publish(msg : PeaPodMessage) : Promise<void>
}

type IoTConfig = {
    deviceid?: string,
    projectid: string,
    cloudregion: string,
    registryid: string,
    jwtexpiryminutes: number
}

type CloudPonicsConfig = {
    project: string,
    run: string
}

type DeviceInfo = {
    idevice: iot.protos.google.cloud.iot.v1.IDevice,
    privatekey: string,
    name: string
}

export class PeaPodFirebase implements IPeaPodPublisher {
    private iotClient : iot.DeviceManagerClient;
    private pubsub : PubSub;
    private mqttclient? : mqtt.Client;
    private servercert? : string;
    private device? : DeviceInfo;
    private lasttokenrefresh : number = 0;
    private tokenrefreshinterval? : NodeJS.Timeout;
    constructor(readonly iotconfig: IoTConfig, readonly cloudconfig : CloudPonicsConfig){
        this.iotClient = new iot.v1.DeviceManagerClient();
        this.pubsub = new PubSub();
    }
    async initialize(logger : (msg: string, finished: boolean) => void = ()=>{}): Promise<void> {
        logger('Fetching Google root CA certificates...', false);
        this.servercert = (await axios.get("https://pki.goog/roots.pem")).data as string;
        logger('Certificates fetched:\n'+this.servercert.substring(0,100), true);
        // ASSUMPTION: New device IFF no existing keypair
        if(!(this.iotconfig.deviceid && fs.existsSync('./rsa_private.pem'))){
            logger('Registering new device...', false);
            try{
            this.device = await this.register();
            } catch (err) {
                console.log(err);
                throw err;
            }
            logger(`New device '${this.device.name}' registered successfully!`, true);
        } else {
            // TODO: Move device info fetching to cloud functions, fix name placeholder
            // Full list of device fields: https://cloud.google.com/iot/docs/reference/cloudiot/rest/v1/projects.locations.registries.devices
            logger('Fetching device metadata...', false);
            const device = await this.iotClient.getDevice({
                name: this.iotClient.devicePath(
                    this.iotconfig.projectid,
                    this.iotconfig.cloudregion,
                    this.iotconfig.registryid,
                    this.iotconfig.deviceid
                ),
                fieldMask: {
                    paths: [
                        'id',
                        'name',
                        'num_id',
                        'credentials',
                        'last_heartbeat_time',
                        'last_event_time',
                        'last_state_time',
                        'last_config_ack_time',
                        'last_config_send_time',
                        'blocked',
                        'last_error_time',
                        'last_error_status',
                        'config',
                        'state',
                        'log_level',
                        'metadata',
                        'gateway_config',
                    ],
                }
            });
            logger(`Device '${device[0].id}' metadata retrieved!`, true);
            this.device = {
                name: 'placeholder',
                idevice: device[0],
                privatekey: fs.readFileSync('./rsa_private.key').toString()
            };
        }
        logger('Connecting to MQTT bridge...', false);
        this.mqttclient = await this.connect();
        logger('Connected to MQTT bridge!', true);
        this.tokenrefreshinterval = setInterval(async ()=>{
            logger('Refreshing token...', false);
            this.mqttclient = await this.connect();
            logger('Token refreshed. Reconnected.', true);
        }, this.iotconfig.jwtexpiryminutes*60*1000)
    }
    start(onmessage: (topic: string, msg: string) => void, onerror: (err: Error) => void) : void{
        this.mqttclient?.on('error', err => {
            onerror(err);
        });
        this.mqttclient?.on('message', (topic, message) => {
            // Parse topic as the last segment
            onmessage(topic.substring(topic.lastIndexOf('/')), message.toString('ascii'));
        });
    }
    async publish(msg: PeaPodMessage): Promise<void> {
        if(Date.now() / 1000 - this.lasttokenrefresh > this.iotconfig.jwtexpiryminutes*60){
            await this.refreshToken();
        }
        // qos=0: at most ONCE delivery
        // TODO: confirmation response from backend?
        let payload : string = (msg.type == 'data' ? 
            // Matches IData interface on backend
            JSON.stringify({
                label: Object.keys(msg.msg)[0],
                value: Object.values(msg.msg)[0],
                timestamp: Date.now(),
                project: this.cloudconfig.project,
                run: this.cloudconfig.run
            }) 
        : JSON.stringify(msg.msg));
        return new Promise<void>((res, rej)=>{
            this.mqttclient?.publish(`/devices/${this.device?.idevice.id}/events/${msg.type}`, payload, {qos: 0}, err=>{
                if(err){
                    rej(err);
                } else {
                    res();
                }
            });
        });
    }

    async connect() : Promise<MqttClient> {
        if(this.mqttclient?.connected){
            await new Promise<void>(res=>{this.mqttclient?.end(true, undefined, res)});
        }
        console.log(1);
        console.log(`projects/${this.iotconfig.projectid}/locations/${this.iotconfig.cloudregion}/registries/${this.iotconfig.registryid}/devices/${this.device?.idevice.id}`)
        console.log(this.refreshToken());
        let client = mqtt.connect({
            host: 'mqtt.googleapis.com',
            port: 8883,
            clientId: `projects/${this.iotconfig.projectid}/locations/${this.iotconfig.cloudregion}/registries/${this.iotconfig.registryid}/devices/${this.device?.idevice.id}`,
            username: 'unused',
            password: this.refreshToken(),
            protocol: 'mqtts',
            secureProtocol: 'TLSv1_2_method',
            ca: [this.servercert],
        });
        console.log(2);
        return new Promise<MqttClient>((res, rej)=>{
            client.on('connect', success => {
                if (success) {
                    console.log(3);
                    res(client);
                } else {
                    rej();
                }
            });
        });
    }
    refreshToken() : string {
        const token = {
            iat: Date.now() / 1000,
            exp: (Date.now() / 1000) + this.iotconfig.jwtexpiryminutes * 60,
            aud: this.iotconfig.projectid,
        };
        this.lasttokenrefresh = Date.now()/1000;
        return jwt.sign(token, this.device?.privatekey as string, {algorithm: 'RS256'});
    }
    async register(): Promise<DeviceInfo> {
        //Generate name
        const name = namegen().raw.map((word)=>{
            return (word as string).slice(0,1).toUpperCase()+(word as string).slice(1)
        }).join(' ');
        const func = firebase.functions().httpsCallable('createDevice');
        // As per cloudponics documentation:
        // Request: `{ devicename: string, region: string, registry: string }`
        // Response: `{ device: iot ... IDevice, privatekey: string }`
        const result = await func({devicename: name, region: this.iotconfig.cloudregion, registry: this.iotconfig.registryid});
        fs.writeFileSync('./rsa_private.pem', result.data.privatekey);
        return {idevice: result.data.device, privatekey: result.data.privatekey, name: name};
    }
}