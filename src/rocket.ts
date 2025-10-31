export const rocket_model: string = `name: Rocket

components:
  - name: Thruster
    components:
      - name: Propeller
      - name: VectoringControl
  - name: Communication
    components:
      - name: UHF
  - name: Control
    components:
      - name: OnBoardComputer

connections:
  - name: Telemetry
    from: OnBoardComputer
    to: UHF
  - name: ThrustControl
    from: OnBoardComputer
    to: Propeller
`;
