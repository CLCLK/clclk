(() => {
  function resetExhibition() {
    window.location.reload();
  }

  document.getElementById("reset-button").addEventListener("click", resetExhibition);
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    // 키보드가 한글 입력 상태여도 같은 물리 키로 리셋합니다.
    if (event.code !== "KeyR" && event.key.toLowerCase() !== "r") return;
    event.preventDefault();
    resetExhibition();
  });
})();
