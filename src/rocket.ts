export const rocket_model: string = `name: LaunchSystem

components:
  - name: Rocket
    components:
      - name: Propeller
      - name: OnBoardComputer
      - name: Radio
  - name: GroundSegment
    components:
      - name: GroundStation
      - name: MissionControl

connections:
  - name: RemoteControl
    from: GroundSegment
    to: Rocket

  - name: Telecommands
    from: MissionControl
    to: GroundStation

  - name: Telemetry
    from: OnBoardComputer
    to: Radio
    
  - name: ThrustControl
    from: OnBoardComputer
    to: Propeller
    protocol: RadioLink

protocols:
  - name: RadioLink
    is_abstract: false
  - name: UART

`;
