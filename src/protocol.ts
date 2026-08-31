export type ControllerState = {
  type: 'state'
  seq: number
  steering: number
  throttle: number
  brake: number
  clutch: number
  handbrake: boolean
  manualGear: number
}

export type ControllerEvent = {
  type: 'event'
  action: 'gearUp' | 'gearDown' | 'center'
}

export type PairMessage = {
  type: 'pair'
  token: string
}

export type OutboundMessage = ControllerState | ControllerEvent | PairMessage
