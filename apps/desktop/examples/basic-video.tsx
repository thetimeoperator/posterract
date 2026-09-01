/** @jsxImportSource @posterract/composition */

/** @inspect color path="Brand/Accent" */
const accent = "#65ff9a";

export default function Project() {
  return (
    <stage id="workspace" background="#020604">
      <scene id="main" name="Main video" width={1080} height={1920} fill="#03100b" active>
        <rect id="panel" x={72} y={180} width={936} height={1560} cornerRadius={52} fill="#071b13" />
        <text id="title" x={140} y={320} width={800} height={220} fontSize={92} color={accent}>
          Create with Posterract.
        </text>
      </scene>
    </stage>
  );
}
