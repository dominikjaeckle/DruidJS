import { neumair_sum } from "../numerical/index";
import * as tf from "@tensorflow/tfjs"
/**
 * @class
 * @alias Matrix
 * @requires module:numerical/neumair_sum
 */
export class Matrix{
    /**
     * creates a new Matrix. Entries are stored in a Float64Array. 
     * @constructor
     * @memberof module:matrix
     * @alias Matrix
     * @param {number} rows - The amount of rows of the matrix.
     * @param {number} cols - The amount of columns of the matrix.
     * @param {(function|string|number)} value=0 - Can be a function with row and col as parameters, a number, or "zeros", "identity" or "I", or "center".
     *  - **function**: for each entry the function gets called with the parameters for the actual row and column.
     *  - **string**: allowed are
     *      - "zero", creates a zero matrix.
     *      - "identity" or "I", creates an identity matrix.
     *      - "center", creates an center matrix.
     *  - **number**: create a matrix filled with the given value.
     * @example
     * 
     * let A = new Matrix(10, 10, () => Math.random()); //creates a 10 times 10 random matrix.
     * let B = new Matrix(3, 3, "I"); // creates a 3 times 3 identity matrix.
     * @returns {Matrix} returns a {@link rows} times {@link cols} Matrix filled with {@link value}.
     */
    constructor(rows=null, cols=null, value=null) {
        this._rows = rows;
        this._cols = cols;
        this._data = null;
        if (rows && cols) {
            if (value === null) {
                return this;
            }
            if (typeof(value) === "function") {
                const tmp = new Float32Array(rows * cols);
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        tmp[row * cols + col] = value(row, col);
                    }
                }
                this._data = tf.tensor2d(tmp, [rows, cols])
                return this;
            }
            if (typeof(value) === "string") {
                if (value === "zeros") {
                    this._data = tf.zeros([rows, cols]); 
                    return this
                }
                if (value === "identity" || value === "I") {
                    this._data = tf.eye(rows, cols);
                    return this
                }
                if (value === "center" && rows == cols) {
                    const tmp = new Float32Array(rows * cols);
                    value = (i, j) => (i === j ? 1 : 0) - (1 / rows);
                    for (let row = 0; row < rows; ++row) {
                        for (let col = 0; col < cols; ++col) {
                            tmp[row * cols + col] = value(row, col);
                        }
                    }
                    this._data = tf.tensor2d(tmp, [rows, cols]);
                    return this;
                }
            }
            if (typeof(value) === "number") {
                this._data = tf.fill([rows, cols], value)
                return this;
            }
        }
        return this;
    }

    /**
     * Creates a Matrix out of {@link A}.
     * @param {(Matrix|Array|Float64Array|number)} A - The matrix, array, or number, which should converted to a Matrix.
     * @param {"row"|"col"|"diag"} [type = "row"] - If {@link A} is a Array or Float64Array, then type defines if it is a row- or a column vector. 
     * @returns {Matrix}
     * 
     * @example
     * let A = Matrix.from([[1, 0], [0, 1]]); //creates a two by two identity matrix.
     * let S = Matrix.from([1, 2, 3], "diag"); // creates a three by three matrix with 1, 2, 3 on its diagonal.
     */
    static from(A, type="row") {
        if (A instanceof Matrix) {
            return A.clone();
        } else if (Array.isArray(A) || A instanceof Float64Array) {
            let m = A.length
            if (m === 0) throw "Array is empty";
            // 1d
            if (!Array.isArray(A[0]) && !(A[0] instanceof Float64Array)) {
                if (type === "row") {  
                    return new Matrix(1, m, (_, j) => A[j]);
                } else if (type === "col") {
                    return new Matrix(m, 1, (i) => A[i]);
                } else if (type === "diag") {
                    return new Matrix(m, m, (i, j) => (i == j) ? A[i] : 0);
                } else {
                    throw "1d array has NaN entries"
                }
            // 2d
            } else if (Array.isArray(A[0]) || A[0] instanceof Float64Array) {
                let n = A[0].length;
                for (let row = 0; row < m; ++row) {
                    if (A[row].length !== n) throw "various array lengths";
                }
                return new Matrix(m, n, (i, j) => A[i][j])
            }
        } else if (typeof(A) === "number") {
            return new Matrix(1, 1, A);
        } else {
            throw "error"
        }
    }

    /**
     * Returns the {@link row}th row from the Matrix.
     * @param {int} row 
     * @returns {Array}
     */
    row(row) {
        return this._data.gather(row, 0).arraySync();
    }

    /**
     * Sets the entries of {@link row}th row from the Matrix to the entries from {@link values}.
     * @param {int} row 
     * @param {Array} values 
     * @returns {Matrix}
     */
    set_row(row, values) {
        let cols = this._cols;
        if (Array.isArray(values) && values.length === cols) {
            const buffer = this._data.bufferSync();
            for (let col = 0; col < cols; ++col) {
                buffer.set(values[col], [row, col]);
            }
            this._data = buffer.toTensor();
        } 
        return this;
    }

    /**
     * Returns the {@link col}th column from the Matrix.
     * @param {int} col 
     * @returns {Array}
     */
    col(col) {
        return this._data.gather(col, 1).arraySync();
    }

    /**
     * Returns the {@link col}th entry from the {@link row}th row of the Matrix.
     * @param {int} row 
     * @param {int} col 
     * @returns {float64}
     */
    entry(row, col) {
        return this._data.bufferSync().get(row, col);
    }

    /**
     * Sets the {@link col}th entry from the {@link row}th row of the Matrix to the given {@link value}.
     * @param {int} row 
     * @param {int} col 
     * @param {float64} value
     * @returns {Matrix}
     */
    set_entry(row, col, value) {
        const buffer = this._data.bufferSync();
        buffer.set(value, row, col);
        this._data = buffer.toTensor();
        return this;
    }

    /**
     * Returns a new transposed Matrix.
     * @returns {Matrix}
     */
    transpose() {
        let B = new Matrix(this._cols, this._rows)
        B._data = this._data.clone().transpose();
        return B;
    }

    /**
     * Returns a new transposed Matrix. Short-form of {@function transpose}.
     * @returns {Matrix}
     */
    get T() {
        return this.transpose();
    }

    /**
     * Returns the inverse of the Matrix.
     * @returns {Matrix}
     */
    inverse() {
        const rows = this._rows;
        const cols = this._cols;
        let B = new Matrix(rows, 2 * cols, (i,j) => {
            if (j >= cols) {
                return (i === (j - cols)) ? 1 : 0;
            } else {
                return this.entry(i, j);
            }
        });
        let h = 0; 
        let k = 0;
        while (h < rows && k < cols) {
            var i_max = 0;
            let max_val = -Infinity;
            for (let i = h; i < rows; ++i) {
                let val = Math.abs(B.entry(i,k));
                if (max_val < val) {
                    i_max = i;
                    max_val = val;
                }
            }
            if (B.entry(i_max, k) == 0) {
                k++;
            } else {
                // swap rows
                for (let j = 0; j < 2 * cols; ++j) {
                    let h_val = B.entry(h, j);
                    let i_val = B.entry(i_max, j);
                    B.set_entry(h, j, h_val);
                    B.set_entry(i_max, j, i_val);
                }
                for (let i = h + 1; i < rows; ++i) {
                    let f = B.entry(i, k) / B.entry(h, k);
                    B.set_entry(i, k, 0)
                    for (let j = k + 1; j < 2 * cols; ++j) {
                        B.set_entry(i, j, B.entry(i, j) - B.entry(h, j) * f);
                    }
                }
                h++;
                k++;
            }
        }

        for (let row = 0; row < rows; ++row) {
            let f = B.entry(row, row);
            for (let col = row; col < 2 * cols; ++col) {
                B.set_entry(row, col, B.entry(row, col) / f)
            }
        }
        
        for (let row = rows - 1; row >= 0; --row) {
            let B_row_row = B.entry(row, row);
            for (let i = 0; i < row; i++) {
                let B_i_row = B.entry(i, row);
                let f = B_i_row / B_row_row;
                for (let j = i; j < 2 * cols; ++j) {
                    let B_i_j = B.entry(i,j);
                    let B_row_j = B.entry(row, j);
                    B_i_j = B_i_j - B_row_j * f;
                    B.set_entry(i, j, B_i_j)
                }
            }
        }

        return new Matrix(rows, cols, (i,j) => B.entry(i, j + cols));
    }

    /**
     * Returns the dot product. If {@link B} is an Array or Float64Array then an Array gets returned. If {@link B} is a Matrix then a Matrix gets returned.
     * @param {(Matrix|Array|Float64Array)} B the right side
     * @returns {(Matrix|Array)}
     */
    dot(B) {
        if (B instanceof Matrix) {
            const A = this;
            if (A.shape[1] !== B.shape[0]) {
                throw `A.dot(B): A is a ${A.shape.join(" x ")}-Matrix, B is a ${B.shape.join(" x ")}-Matrix: 
                A has ${A.shape[1]} cols and B ${B.shape[0]} rows. 
                Must be equal!`;
            }
            const C = new Matrix(A.shape[0], B.shape[1]);
            C._data = A._data.dot(B._data);
            return C;
        } else if (Array.isArray(B) || (B instanceof Float64Array)) {
            let rows = this._rows;
            if (B.length !== rows)  {
                throw `A.dot(B): A has ${rows} cols and B has ${B.length} rows. Must be equal!`
            }
            let C = new Array(rows)
            for (let row = 0; row < rows; ++row) {
                C[row] = neumair_sum(this.row(row).map(e => e * B[row]));
            }
            return C;
        } else {
            throw `B must be Matrix or Array`;
        }
    }

    /**
     * Computes the outer product from {@link this} and {@link B}.
     * @param {Matrix} B 
     * @returns {Matrix}
     */
    outer(B) {
        let A = this;
        let l = A._data.length;
        let r = B._data.length;
        if (l != r) return undefined;
        let C = new Matrix(l, l);
        C._data = tf.outerProduct(A._data.arraySync(), B._data.arraySync());
        return C;
    }

    /**
     * Appends matrix {@link B} to the matrix.
     * @param {Matrix} B - matrix to append.
     * @param {"horizontal"|"vertical"|"diag"} [type = "horizontal"] - type of concatenation.
     * @returns {Matrix}
     * @example
     * 
     * let A = Matrix.from([[1, 1], [1, 1]]); // 2 by 2 matrix filled with ones.
     * let B = Matrix.from([[2, 2], [2, 2]]); // 2 by 2 matrix filled with twos.
     * 
     * A.concat(B, "horizontal"); // 2 by 4 matrix. [[1, 1, 2, 2], [1, 1, 2, 2]]
     * A.concat(B, "vertical"); // 4 by 2 matrix. [[1, 1], [1, 1], [2, 2], [2, 2]]
     * A.concat(B, "diag"); // 4 by 4 matrix. [[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 2, 2], [0, 0, 2, 2]]
     */
    concat(B, type="horizontal") {
        const A = this;
        const [rows_A, cols_A] = A.shape;
        const [rows_B, cols_B] = B.shape;
        if (type == "horizontal") {
            if (rows_A != rows_B) throw `A.concat(B, "horizontal"): A and B need same number of rows, A has ${rows_A} rows, B has ${rows_B} rows.`;
            const X = new Matrix(rows_A, cols_A + cols_B);
            X._data = tf.concat2d([A._data, B._data], 1)
            return X;
        } else if (type == "vertical") {
            if (cols_A != cols_B) throw `A.concat(B, "vertical"): A and B need same number of columns, A has ${cols_A} columns, B has ${cols_B} columns.`;
            const X = new Matrix(rows_A + rows_B, cols_A);
            X._data = tf.concat2d([A._data, B._data], 0)
            return X;
        } else if (type == "diag") {
            const UR = new Matrix(rows_A, cols_B, "zeros");
            const BL = new Matrix(rows_B, cols_A, "zeros");
            return A.concat(UR, "horizontal").concat(BL.concat(B, "horizontal"), "vertical");
        } else {
            throw `type must be "horizontal" or "vertical", but type is ${type}!`;
        }
    }

    /**
     * Writes the entries of B in A at an offset position given by {@link offset_row} and {@link offset_col}.
     * @param {int} offset_row 
     * @param {int} offset_col 
     * @param {Matrix} B 
     * @returns {Matrix}
     */
    set_block(offset_row, offset_col, B) {
        let [ rows, cols ] = B.shape;
        for (let row = 0; row < rows; ++row) {
            if (row > this._rows) continue;
            for (let col = 0; col < cols; ++col) {
                if (col > this._cols) continue;
                this.set_entry(row + offset_row, col + offset_col, B.entry(row, col));
            }
        }
        return this;
    }

    /**
     * Extracts the entries from the {@link start_row}th row to the {@link end_row}th row, the {@link start_col}th column to the {@link end_col}th column of the matrix.
     * If {@link end_row} or {@link end_col} is empty, the respective value is set to {@link this.rows} or {@link this.cols}.
     * @param {Number} start_row 
     * @param {Number} start_col
     * @param {Number} [end_row = null]
     * @param {Number} [end_col = null] 
     * @returns {Matrix} Returns a end_row - start_row times end_col - start_col matrix, with respective entries from the matrix.
     * @example
     * 
     * let A = Matrix.from([[1, 2, 3], [4, 5, 6], [7, 8, 9]]); // a 3 by 3 matrix.
     * 
     * A.get_block(1, 1).to2dArray; // [[5, 6], [8, 9]]
     * A.get_block(0, 0, 1, 1).to2dArray; // [[1]]
     * A.get_block(1, 1, 2, 2).to2dArray; // [[5]]
     * A.get_block(0, 0, 2, 2).to2dArray; // [[1, 2], [4, 5]]
     */
    get_block(start_row, start_col, end_row = null, end_col = null) {
        const [ rows, cols ] = this.shape;
        /*if (!end_row)) {
            end_row = rows;
        }
            end_col = cols;
        }*/
        end_row = end_row || rows;
        end_col = end_col || cols;
        if (end_row <= start_row || end_col <= start_col) {
            throw `
                end_row must be greater than start_row, and 
                end_col must be greater than start_col, but
                end_row = ${end_row}, start_row = ${start_row}, end_col = ${end_col}, and start_col = ${start_col}!`;
        }
        const X = new Matrix(end_row - start_row, end_col - start_col, "zeros");
        for (let row = start_row, new_row = 0; row < end_row; ++row, ++new_row) {
            for (let col = start_col, new_col = 0; col < end_col; ++col, ++new_col) {
                X.set_entry(new_row, new_col, this.entry(row, col));
            }
        }
        return X;
        //return new Matrix(end_row - start_row, end_col - start_col, (i, j) => this.entry(i + start_row, j + start_col));
    }

    /**
     * Applies a function to each entry of the matrix.
     * @param {function} f function takes 2 parameters, the value of the actual entry and a value given by the function {@link v}. The result of {@link f} gets writen to the Matrix.
     * @param {function} v function takes 2 parameters for row and col, and returns a value witch should be applied to the colth entry of the rowth row of the matrix.
     */
    _apply_array(f, v) {
        const data = this._data.bufferSync();
        const [ rows, cols ] = this.shape;
        for (let row = 0; row < rows; ++row) {
            for (let col = 0; col < cols; ++col) {
                const d = data.get(row, col);
                data.set(f(d, v(row, col)), row, col);
            }
        }
        this._data = data.toTensor();
        return this; 
    }

    _apply_rowwise_array(values, f) {
        return this._apply_array(f, (i, j) => values[j]);
    }

    _apply_colwise_array(values, f) {
        const data = this._data.bufferSync();
        const [ rows, cols ] = this.shape;
        for (let row = 0; row < rows; ++row) {
            for (let col = 0; col < cols; ++col) {
                const d = data.get(row, col);
                data.set(f(d, values[row]), row, col);
            }
        }
        this._data = data.toTensor();
        return this; 
    }

    _apply(value, f) {
        let data = this._data.bufferSync();
        if (value instanceof Matrix) {
            let [ value_rows, value_cols ] = value.shape;
            let [ rows, cols ] = this.shape;
            if (value_rows === 1) {
                if (cols !== value_cols) {
                    throw `cols !== value_cols`;
                }
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        data.set(f(data.get(row, col), value.entry(0, col)), row, col);
                    }
                }
            } else if (value_cols === 1) {
                if (rows !== value_rows) {
                    throw `rows !== value_rows`;
                }
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        data.set(f(data.get(row, col), value.entry(row, 0)), row, col);
                    }
                }
            } else if (rows == value_rows && cols == value_cols) {
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        data.set(f(data.get(row, col), value.entry(row, col)), row, col);
                    }
                }
            } else {
                throw `error`;
            }
        } else if (Array.isArray(value)) {
            let rows = this._rows;
            let cols = this._cols;
            if (value.length === rows) {
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        data.set(f(data.get(row, col), value[row]), row, col);
                    }
                }
            } else if (value.length === cols) {
                for (let row = 0; row < rows; ++row) {
                    for (let col = 0; col < cols; ++col) {
                        data.set(f(data.get(row, col), value[col]), row, col);
                    }
                }
            } else {
                throw `error`;
            }
        } else {
            let rows = this._rows;
            let cols = this._cols;
            for (let row = 0; row < rows; ++row) {
                for (let col = 0; col < cols; ++col) {
                    data.set(f(data.get(row, col), value), row, col);   
                }
            }
        }
        this._data = data.toTensor();
        return this;
    }

    /**
     * Clones the Matrix.
     * @returns {Matrix}
     */
    clone() {
        let B = new Matrix()
        B._rows = this._rows;
        B._cols = this._cols;
        B._data = this._data.clone();
        return B;
    }

    mult(value) {
        const B = this.clone()
        if (value instanceof Matrix) {
            B._data.mul(value._data)
        } else if (typeof(value) === "number") {
            B._data.mul(tf.scalar(value))
        } else {
            B._data.mul(value);
        }
        return B
    }

    divide(value) {
        const B = this.clone()
        if (value instanceof Matrix) {
            B._data.div(value._data)
        } else if (typeof(value) === "number") {
            B._data.div(tf.scalar(value))
        } else {
            B._data.div(value);
        }
        return B
    }

    add(value) {
        const B = this.clone()
        if (value instanceof Matrix) {
            B._data.add(value._data)
        } else if (typeof(value) === "number") {
            B._data.add(tf.scalar(value))
        } else {
            B._data.add(value);
        }
        return B
    }

    sub(value) {
        const B = this.clone()
        if (value instanceof Matrix) {
            B._data.sub(value._data)
        } else if (typeof(value) === "number") {
            B._data.sub(tf.scalar(value))
        } else {
            B._data.sub(value);
        }
        return B
    }

    /**
     * Returns the number of rows and columns of the Matrix.
     * @returns {Array} An Array in the form [rows, columns].
     */
    get shape() {
        return [this._rows, this._cols];
    }

    /**
     * Returns the matrix in the given shape with the given function which returns values for the entries of the matrix.
     * @param {Array} parameter - takes an Array in the form [rows, cols, value], where rows and cols are the number of rows and columns of the matrix, and value is a function which takes two parameters (row and col) which has to return a value for the colth entry of the rowth row.
     * @returns {Matrix}
     */
    set shape([rows, cols, value = () => 0]) {
        this._rows = rows;
        this._cols = cols;
        const data = new Float64Array(rows * cols);
        for (let row = 0; row < rows; ++row) {
            for (let col = 0; col < cols; ++col) {
                data[row * cols + col] = value(row, col);
            }
        }
        this._data = tf.tensor2d(data, [rows, cols]);
        return this;
    }

    /**
     * Returns the Matrix as a two-dimensional Array.
     * @returns {Array}
     */
    get to2dArray() {
        return this._data.arraySync();
    }

    /**
     * Returns the diagonal of the Matrix.
     * @returns {Array}
     */
    get diag() {
        const rows = this._rows;
        const cols = this._cols;
        const min_row_col = Math.min(rows, cols);
        let result = new Array(min_row_col)
        for (let i = 0; i < min_row_col; ++i) {
            result[i] = this.entry(i,i);
        }
        return result;
    }

    /**
     * Returns the mean of all entries of the Matrix.
     * @returns {float64}
     */
    get mean() {
        return this._data.mean().dataSync()[0];
    }

    /**
     * Returns the mean of each row of the matrix.
     * @returns {Array}
     */
    get meanRows() {
        return Array.from(this._data.mean(0, true).dataSync());
    }

    /** Returns the mean of each column of the matrix.
     * @returns {Array}
     */
    get meanCols() {
        return Array.from(this._data.mean(1, true).dataSync());
    }

    /**
     * Solves the equation {@link A}x = {@link b}. Returns the result x.
     * @param {Matrix} A - Matrix
     * @param {Matrix} b - Matrix
     * @returns {Matrix}
     */
    static solve(A, b) {
        let rows = A.shape[0];
        let { L: L, U: U } = Matrix.LU(A);//lu(A);
        let x = b.clone();
        
        // forward
        for (let row = 0; row < rows; ++row) {
            for (let col = 0; col < row - 1; ++col) {
                x.set_entry(0, row, x.entry(0, row) - L.entry(row, col) * x.entry(1, col));
            }
            x.set_entry(0, row, x.entry(0, row) / L.entry(row, row));
        }
        
        // backward
        for (let row = rows - 1; row >= 0; --row) {
            for (let col = rows - 1; col > row; --col) {
                x.set_entry(0, row, x.entry(0, row) - U.entry(row, col) * x.entry(0, col));
            }
            x.set_entry(0, row, x.entry(0, row) / U.entry(row, row));
        }

        return x;
    }

    /**
     * {@link L}{@link U} decomposition of the Matrix {@link A}. Creates two matrices, so that the dot product LU equals A.
     * @param {Matrix} A 
     * @returns {{L: Matrix, U: Matrix}} result - Returns the left triangle matrix {@link L} and the upper triangle matrix {@link U}.
     */
    static LU(A) {
        const rows = A.shape[0];
        const L = new Matrix(rows, rows, "zeros");
        const U = new Matrix(rows, rows, "identity");
        
        for (let j = 0; j < rows; ++j) {
            for (let i = j; i < rows; ++i) {
                let sum = 0
                for (let k = 0; k < j; ++k) {
                    sum += L.entry(i, k) * U.entry(k, j)
                }
                L.set_entry(i, j, A.entry(i, j) - sum);
            }
            for (let i = j; i < rows; ++i) {
                if (L.entry(j, j) === 0) {
                    return undefined;
                }
                let sum = 0
                for (let k = 0; k < j; ++k) {
                    sum += L.entry(j, k) * U.entry(k, i)
                }
                U.set_entry(j, i, (A.entry(j, i) - sum) / L.entry(j, j));
            }
        }

        return { L: L, U: U };
    }

    /**
     * Computes the {@link k} components of the SVD decomposition of the matrix {@link M}
     * @param {Matrix} A 
     * @param {int} [k=2] 
     * @returns {{U: Matrix, Sigma: Matrix, V: Matrix}}
     */
    static SVD(A, k=2) {
        /*const MT = M.T;
        let MtM = MT.dot(M);
        let MMt = M.dot(MT);
        let { eigenvectors: V, eigenvalues: Sigma } = simultaneous_poweriteration(MtM, k);
        let { eigenvectors: U } = simultaneous_poweriteration(MMt, k);
        return { U: U, Sigma: Sigma.map(sigma => Math.sqrt(sigma)), V: V };*/
        
        //Algorithm 1a: Householder reduction to bidiagonal form:
        const [m, n] = A.shape;
        let U = new Matrix(m, n, (i, j) => i == j ? 1 : 0);
        console.log(U.to2dArray)
        let V = new Matrix(n, m, (i, j) => i == j ? 1 : 0);
        console.log(V.to2dArray)
        let B = Matrix.bidiagonal(A.clone(), U, V);
        console.log(U,V,B)
        return { U: U, "Sigma": B, V: V };
    }
}