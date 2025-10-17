const age = 20;
const votingStatus = (age >= 18) ? "Eligible to Vote" : "Not Eligible";
const user = { name: "John", score: 80 };
if (user.score >= 75) {
  console.log("Passed");
}
document.querySelector("#btn").addEventListener("click", () => {
  console.log("Button clicked!");
});
