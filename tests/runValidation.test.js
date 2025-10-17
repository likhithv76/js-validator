import { runJSValidation } from "../validators/jsvalidator.js";

describe("JS Validator Integration", function () {
  it("should run all JS test cases successfully", async function () {
    const result = await runJSValidation("./configs/testcase copy.json");
    console.log(JSON.stringify(result, null, 2));
  });
});
