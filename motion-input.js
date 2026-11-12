const gestures = [
  { id: "smile", label: "웃기", icon: "😊" },
  { id: "wave", label: "손 흔들기", icon: "👋" },
  { id: "fist", label: "주먹 쥐기", icon: "✊" },
  { id: "victory", label: "브이", icon: "✌️" },
];

function createMotionInput(onMotion) {
  // 나중에 MediaPipe가 새 동작을 인식하면 emit("smile")처럼 한 번 호출합니다.
  return {
    emit(gestureId) {
      const gesture = gestures.find((item) => item.id === gestureId);
      if (gesture) onMotion(gesture);
    },
  };
}
