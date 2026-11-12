// 얼굴 크기에 맞춰 머리 위 여백부터 어깨까지 자동 확대합니다.
// 모션 판정은 이 확대 영상이 아니라 원본 카메라 영상을 사용합니다.
function getFaceShoulderCrop(face, videoWidth, videoHeight, ratio = 16 / 9) {
  const height = Math.min(videoHeight, videoWidth / ratio, Math.max(40, face.height * 2.05));
  const width = height * ratio;
  return {
    x: Math.max(0, Math.min(videoWidth - width, face.originX + face.width / 2 - width / 2)),
    y: Math.max(0, Math.min(videoHeight - height, face.originY - face.height * 0.27)),
    width, height,
  };
}
if (typeof module !== 'undefined') module.exports = { getFaceShoulderCrop };
