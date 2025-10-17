// Create and append a button
const btn = document.createElement("button");
btn.id = "clickBtn";
btn.textContent = "Click Me";
btn.addEventListener("click", function () {
  this.textContent = "Clicked!";
});
document.body.appendChild(btn);

// Create and append a hover button
const hoverBtn = document.createElement("button");
hoverBtn.id = "hoverBtn";
hoverBtn.textContent = "Hover Me";
hoverBtn.addEventListener("mouseover", function () {
  this.textContent = "Hovered!";
});
document.body.appendChild(hoverBtn);

// Create and append a form
const form = document.createElement("form");
form.id = "myForm";
form.addEventListener("submit", function (e) {
  e.preventDefault();
  this.dataset.submitted = "true";
});
document.body.appendChild(form);
