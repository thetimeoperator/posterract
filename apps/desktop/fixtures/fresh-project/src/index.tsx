/** @jsxImportSource @posterract/composition */

export default function Project() {
  return (
    <stage id="workspace" background="#020604">
      <scene id="main" name="Main video" width={1080} height={1920} fill="#03100b" active>
        <text id="title" x={100} y={200} width={880} height={240} fontSize={96} color="#65ff9a">
          Create with Posterract.
        </text>
      </scene>
    </stage>
  );
}
