import { IPeaPodArduino } from './PeaPodArduino';
import { PeaPodMessage } from './PeaPod';

function stringTuple<T extends [string] | string[]>(...data: T): T {
    return data;
}

// Object fields can't be hyphenated, so I underscored them
const DataLabels = stringTuple('air_temperature', 'water_level');
export type TDataLabels = typeof DataLabels[number];
export type SimulatorParameters = {
    [key in TDataLabels]: {
        min: number,
        max: number,
        interval: number
    }
}

export type ArduinoData = PeaPodMessage & {
    type: 'data', msg: {
        [key: string]: number
    }
};

function generateData(label: TDataLabels, min : number, max : number) : ArduinoData {
    let data : ArduinoData = {
        type: 'data',
        msg: {}
    };
    data.msg[label.replace('_','-')] = Math.random()*(max-min)+min;
    return data;
}

export class ArduinoSimulator implements IPeaPodArduino{
    intervals : NodeJS.Timeout[] = []
    constructor(public parameters : SimulatorParameters){}
    start(onMessage: (msg: PeaPodMessage) => any): void {
        for(const label in this.parameters){
            this.intervals.push(setInterval(()=>{
                onMessage(generateData(
                    label as TDataLabels, 
                    this.parameters[label as TDataLabels].min, 
                    this.parameters[label as TDataLabels].max));
            }, this.parameters[label as TDataLabels].interval));
        }
    }
    stop(): void {
        for(const interval of this.intervals){
            clearInterval(interval);
        }
    }
}